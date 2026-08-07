import { RequestHandler } from "express";

export function securityHeaders(): RequestHandler {
  return (_req, res, next) => {
    res.setHeader("cache-control", "no-store");
    res.setHeader("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
    res.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("x-frame-options", "DENY");
    next();
  };
}

export function validateMcpAuthority(options: {
  allowedHosts: string[];
  allowedOrigins: string[];
}): RequestHandler {
  const allowedHosts = new Set(options.allowedHosts.map(normalizeHost).filter(Boolean));
  const allowedOrigins = new Set(options.allowedOrigins.map(normalizeOrigin).filter(Boolean));

  return (req, res, next) => {
    const host = normalizeHost(req.headers.host ?? "");
    if (!host || (!allowedHosts.has("*") && !allowedHosts.has(host))) {
      res.status(403).json({ error: "Host is not allowed for this MCP endpoint." });
      return;
    }

    const rawOrigin = req.header("origin")?.trim();
    if (rawOrigin) {
      const origin = normalizeOrigin(rawOrigin);
      if (!origin || (!allowedOrigins.has("*") && !allowedOrigins.has(origin))) {
        res.status(403).json({ error: "Origin is not allowed for this MCP endpoint." });
        return;
      }
    }

    next();
  };
}

export function requireJsonContentType(): RequestHandler {
  return (req, res, next) => {
    if (req.method !== "POST") {
      next();
      return;
    }
    if (!req.is(["application/json", "application/*+json"])) {
      res.status(415).json({ error: "POST /mcp requires an application/json content type." });
      return;
    }
    next();
  };
}

type RateBucket = {
  count: number;
  resetAt: number;
};

export type RateLimiterOptions = {
  windowMs: number;
  maxRequests: number;
  maxClients?: number;
  now?: () => number;
};

export function createRateLimiter(options: RateLimiterOptions): RequestHandler {
  const windowMs = Math.max(1000, options.windowMs);
  const maxRequests = Math.max(1, Math.floor(options.maxRequests));
  const maxClients = Math.max(100, Math.floor(options.maxClients ?? 10000));
  const now = options.now ?? Date.now;
  const buckets = new Map<string, RateBucket>();
  let nextCleanupAt = 0;

  return (req, res, next) => {
    const currentTime = now();
    if (currentTime >= nextCleanupAt) {
      for (const [key, bucket] of buckets) {
        if (currentTime >= bucket.resetAt) buckets.delete(key);
      }
      nextCleanupAt = currentTime + windowMs;
    }

    const key = req.ip || req.socket.remoteAddress || "unknown";
    const existing = buckets.get(key);
    const bucket = !existing || currentTime >= existing.resetAt
      ? { count: 0, resetAt: currentTime + windowMs }
      : existing;
    bucket.count += 1;
    buckets.delete(key);
    buckets.set(key, bucket);

    while (buckets.size > maxClients) {
      const oldestKey = buckets.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      buckets.delete(oldestKey);
    }

    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - currentTime) / 1000));
    res.setHeader("ratelimit-limit", String(maxRequests));
    res.setHeader("ratelimit-remaining", String(Math.max(0, maxRequests - bucket.count)));
    res.setHeader("ratelimit-reset", String(retryAfterSeconds));

    if (bucket.count > maxRequests) {
      res.setHeader("retry-after", String(retryAfterSeconds));
      res.status(429).json({ error: "Too many MCP requests. Retry after the indicated delay." });
      return;
    }

    next();
  };
}

function normalizeHost(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "";
  if (trimmed === "*") return "*";
  try {
    return new URL(`http://${trimmed}`).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function normalizeOrigin(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed === "*") return "*";
  try {
    return new URL(trimmed).origin.toLowerCase();
  } catch {
    return "";
  }
}
