type CacheEntry<T> = {
  expiresAt: number;
  staleUntil: number;
  storedAt: number;
  value: T;
};

export type TtlCacheOptions = {
  maxSize?: number;
  staleTtlMs?: number;
  now?: () => number;
};

export class TtlCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly maxSize: number;
  private readonly staleTtlMs: number;
  private readonly now: () => number;

  constructor(private readonly ttlMs: number, options: TtlCacheOptions = {}) {
    this.maxSize = Math.max(1, Math.floor(options.maxSize ?? 500));
    this.staleTtlMs = Math.max(0, options.staleTtlMs ?? ttlMs);
    this.now = options.now ?? Date.now;
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    const now = this.now();
    if (now > entry.staleUntil) {
      this.entries.delete(key);
      return undefined;
    }
    if (now > entry.expiresAt) {
      return undefined;
    }
    this.touch(key, entry);
    return entry.value;
  }

  getStale(key: string): CacheEntry<T> | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (this.now() > entry.staleUntil) {
      this.entries.delete(key);
      return undefined;
    }
    this.touch(key, entry);
    return entry;
  }

  set(key: string, value: T): void {
    const storedAt = this.now();
    this.pruneExpired(storedAt);
    this.entries.delete(key);
    this.entries.set(key, {
      expiresAt: storedAt + this.ttlMs,
      staleUntil: storedAt + this.ttlMs + this.staleTtlMs,
      storedAt,
      value
    });
    this.evictOverflow();
  }

  get size(): number {
    this.pruneExpired(this.now());
    return this.entries.size;
  }

  private touch(key: string, entry: CacheEntry<T>): void {
    this.entries.delete(key);
    this.entries.set(key, entry);
  }

  private pruneExpired(now: number): void {
    for (const [key, entry] of this.entries) {
      if (now > entry.staleUntil) this.entries.delete(key);
    }
  }

  private evictOverflow(): void {
    while (this.entries.size > this.maxSize) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
    }
  }
}
