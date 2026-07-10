export type AppConfig = {
  port: number;
  authKey?: string;
  kakaoRestApiKey?: string;
  aladinTtbKey?: string;
  cacheTtlMs: number;
  requestTimeoutMs: number;
};

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(): AppConfig {
  return {
    port: readPositiveInt("PORT", 3000),
    authKey: process.env.DATA4LIBRARY_AUTH_KEY?.trim() || undefined,
    kakaoRestApiKey: process.env.KAKAO_REST_API_KEY?.trim() || undefined,
    aladinTtbKey: process.env.ALADIN_TTB_KEY?.trim() || undefined,
    cacheTtlMs: readPositiveInt("CACHE_TTL_SECONDS", 60 * 60 * 6) * 1000,
    requestTimeoutMs: readPositiveInt("REQUEST_TIMEOUT_MS", 5000)
  };
}
