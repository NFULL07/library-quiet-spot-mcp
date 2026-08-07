export type UpstreamProvider = "data4library" | "kakao" | "aladin";

export class UpstreamHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterMs?: number
  ) {
    super(message);
    this.name = "UpstreamHttpError";
  }
}

export class UpstreamTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpstreamTimeoutError";
  }
}

export class CircuitOpenError extends Error {
  constructor(readonly provider: UpstreamProvider, readonly retryAfterMs: number) {
    super(`${provider} circuit is open; retry after ${Math.max(0, Math.ceil(retryAfterMs))}ms`);
    this.name = "CircuitOpenError";
  }
}

export type RetryOptions = {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs?: number;
  shouldRetry: (error: unknown) => boolean;
  sleep?: (delayMs: number) => Promise<void>;
  onRetry?: (event: { attempt: number; nextAttempt: number; delayMs: number; error: unknown }) => void;
};

export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts));
  const maxDelayMs = Math.max(options.baseDelayMs, options.maxDelayMs ?? 2000);
  const sleep = options.sleep ?? ((delayMs: number) => new Promise((resolve) => setTimeout(resolve, delayMs)));

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= maxAttempts || !options.shouldRetry(error)) throw error;
      const retryAfterMs = error instanceof UpstreamHttpError ? error.retryAfterMs : undefined;
      const exponentialDelay = options.baseDelayMs * (2 ** (attempt - 1));
      const delayMs = Math.min(maxDelayMs, Math.max(0, retryAfterMs ?? exponentialDelay));
      options.onRetry?.({ attempt, nextAttempt: attempt + 1, delayMs, error });
      await sleep(delayMs);
    }
  }

  throw new Error("Retry loop completed without a result");
}

export type CircuitState = "closed" | "open" | "half_open";

export type CircuitSnapshot = {
  state: CircuitState;
  consecutiveFailures: number;
  retryAfterMs: number;
};

export type CircuitBreakerOptions = {
  failureThreshold: number;
  resetAfterMs: number;
  now?: () => number;
  onStateChange?: (state: CircuitState, snapshot: CircuitSnapshot) => void;
};

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private consecutiveFailures = 0;
  private openedAt = 0;
  private halfOpenProbeInFlight = false;
  private readonly failureThreshold: number;
  private readonly resetAfterMs: number;
  private readonly now: () => number;

  constructor(readonly provider: UpstreamProvider, private readonly options: CircuitBreakerOptions) {
    this.failureThreshold = Math.max(1, Math.floor(options.failureThreshold));
    this.resetAfterMs = Math.max(1, options.resetAfterMs);
    this.now = options.now ?? Date.now;
  }

  async execute<T>(operation: () => Promise<T>, countsAsFailure: (error: unknown) => boolean): Promise<T> {
    this.beforeRequest();
    try {
      const result = await operation();
      this.recordSuccess();
      return result;
    } catch (error) {
      if (countsAsFailure(error)) {
        this.recordFailure();
      } else if (this.state === "half_open") {
        this.close();
      }
      throw error;
    } finally {
      if (this.state === "half_open") this.halfOpenProbeInFlight = false;
    }
  }

  snapshot(): CircuitSnapshot {
    const retryAfterMs = this.state === "open"
      ? Math.max(0, this.resetAfterMs - (this.now() - this.openedAt))
      : 0;
    return {
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      retryAfterMs
    };
  }

  private beforeRequest(): void {
    if (this.state === "open") {
      const retryAfterMs = this.resetAfterMs - (this.now() - this.openedAt);
      if (retryAfterMs > 0) throw new CircuitOpenError(this.provider, retryAfterMs);
      this.state = "half_open";
      this.halfOpenProbeInFlight = false;
      this.emitStateChange();
    }

    if (this.state === "half_open") {
      if (this.halfOpenProbeInFlight) throw new CircuitOpenError(this.provider, this.resetAfterMs);
      this.halfOpenProbeInFlight = true;
    }
  }

  private recordSuccess(): void {
    if (this.state !== "closed" || this.consecutiveFailures > 0) this.close();
  }

  private recordFailure(): void {
    this.consecutiveFailures += 1;
    if (this.state === "half_open" || this.consecutiveFailures >= this.failureThreshold) {
      this.state = "open";
      this.openedAt = this.now();
      this.halfOpenProbeInFlight = false;
      this.emitStateChange();
    }
  }

  private close(): void {
    this.state = "closed";
    this.consecutiveFailures = 0;
    this.openedAt = 0;
    this.halfOpenProbeInFlight = false;
    this.emitStateChange();
  }

  private emitStateChange(): void {
    this.options.onStateChange?.(this.state, this.snapshot());
  }
}

export function isRetryableUpstreamError(error: unknown): boolean {
  if (error instanceof UpstreamTimeoutError) return true;
  if (error instanceof UpstreamHttpError) {
    if (error.status === 429) {
      return error.retryAfterMs !== undefined && error.retryAfterMs <= 2000;
    }
    return [408, 425, 500, 502, 503, 504].includes(error.status);
  }
  return error instanceof TypeError;
}

export function countsTowardCircuit(error: unknown): boolean {
  if (error instanceof CircuitOpenError) return false;
  if (error instanceof UpstreamHttpError) {
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }
  return true;
}
