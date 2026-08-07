export type AppConfig = {
  port: number;
  authKey?: string;
  kakaoRestApiKey?: string;
  aladinTtbKey?: string;
  cacheTtlMs: number;
  cacheStaleTtlMs: number;
  cacheMaxEntries: number;
  requestTimeoutMs: number;
  logLevel: "debug" | "info" | "warn" | "error";
  upstreamMaxAttempts: number;
  upstreamRetryBaseMs: number;
  circuitFailureThreshold: number;
  circuitResetMs: number;
};

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readLogLevel(): AppConfig["logLevel"] {
  const value = process.env.LOG_LEVEL?.trim().toLowerCase();
  return value === "debug" || value === "warn" || value === "error" ? value : "info";
}

export function loadConfig(): AppConfig {
  return {
    port: readPositiveInt("PORT", 3000),
    authKey: process.env.DATA4LIBRARY_AUTH_KEY?.trim() || undefined,
    kakaoRestApiKey: process.env.KAKAO_REST_API_KEY?.trim() || undefined,
    aladinTtbKey: process.env.ALADIN_TTB_KEY?.trim() || undefined,
    cacheTtlMs: readPositiveInt("CACHE_TTL_SECONDS", 60 * 60 * 6) * 1000,
    cacheStaleTtlMs: readPositiveInt("CACHE_STALE_TTL_SECONDS", 60 * 60 * 24) * 1000,
    cacheMaxEntries: readPositiveInt("CACHE_MAX_ENTRIES", 500),
    requestTimeoutMs: readPositiveInt("REQUEST_TIMEOUT_MS", 5000),
    logLevel: readLogLevel(),
    upstreamMaxAttempts: readPositiveInt("UPSTREAM_MAX_ATTEMPTS", 2),
    upstreamRetryBaseMs: readPositiveInt("UPSTREAM_RETRY_BASE_MS", 150),
    circuitFailureThreshold: readPositiveInt("CIRCUIT_FAILURE_THRESHOLD", 5),
    circuitResetMs: readPositiveInt("CIRCUIT_RESET_MS", 30000)
  };
}
