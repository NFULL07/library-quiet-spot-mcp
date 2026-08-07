import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { createApp } from "../../src/app.js";
import { AppConfig } from "../../src/config.js";
import { noopLogger } from "../../src/logger.js";

const config: AppConfig = {
  port: 0,
  cacheTtlMs: 1000,
  cacheStaleTtlMs: 1000,
  cacheMaxEntries: 50,
  requestTimeoutMs: 1000,
  logLevel: "error",
  upstreamMaxAttempts: 1,
  upstreamRetryBaseMs: 1,
  circuitFailureThreshold: 5,
  circuitResetMs: 1000,
  allowedHosts: ["localhost", "127.0.0.1"],
  allowedOrigins: ["https://playmcp.kakao.com"],
  trustProxyHops: 0,
  rateLimitWindowMs: 60000,
  rateLimitMaxRequests: 2
};

describe("HTTP security boundary", () => {
  const server = createApp(config, { logger: noopLogger }).listen(0);
  let baseUrl = "";

  before(async () => {
    if (!server.listening) {
      await new Promise<void>((resolve) => server.once("listening", resolve));
    }
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });

  it("sets defensive headers without exposing the Express signature", async () => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-powered-by"), null);
  });

  it("rejects untrusted Host and Origin values on the MCP endpoint", async () => {
    const badHostStatus = await postWithHost(baseUrl, "evil.example");
    assert.equal(badHostStatus, 403);

    const badOrigin = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example"
      },
      body: "{}"
    });
    assert.equal(badOrigin.status, 403);
  });

  it("requires JSON and rate-limits repeated MCP requests by client address", async () => {
    const unsupported = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "not-json"
    });
    assert.equal(unsupported.status, 415);

    const call = (id: number) => fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json"
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/list", params: {} })
    });

    const first = await call(1);
    await first.text();
    const second = await call(2);
    await second.text();
    const limited = await call(3);

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("ratelimit-limit"), "2");
    assert.ok(Number(limited.headers.get("retry-after")) >= 1);
  });
});

function postWithHost(baseUrl: string, host: string): Promise<number> {
  const target = new URL("/mcp", baseUrl);
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: target.hostname,
      port: target.port,
      path: target.pathname,
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-length": "2",
        "content-type": "application/json",
        host
      }
    }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode ?? 0));
    });
    request.on("error", reject);
    request.end("{}");
  });
}
