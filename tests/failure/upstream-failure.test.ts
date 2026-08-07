import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AppConfig } from "../../src/config.js";
import { Data4LibraryClient } from "../../src/data4library.js";
import { CircuitOpenError, UpstreamTimeoutError } from "../../src/resilience.js";
import { createRequestContext, runWithRequestContext } from "../../src/request-context.js";

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 3000,
    authKey: "test-key",
    cacheTtlMs: 1,
    cacheStaleTtlMs: 100,
    cacheMaxEntries: 10,
    requestTimeoutMs: 20,
    logLevel: "error",
    upstreamMaxAttempts: 1,
    upstreamRetryBaseMs: 1,
    circuitFailureThreshold: 1,
    circuitResetMs: 1000,
    allowedHosts: ["localhost", "127.0.0.1"],
    allowedOrigins: ["https://playmcp.kakao.com"],
    trustProxyHops: 0,
    rateLimitWindowMs: 60000,
    rateLimitMaxRequests: 100,
    ...overrides
  };
}

describe("upstream failure scenarios", () => {
  it("uses stale data after a circuit opens, then fails after stale retention expires", async () => {
    let now = 0;
    let fetchCalls = 0;
    let upstreamAvailable = true;
    const client = new Data4LibraryClient(config(), {
      now: () => now,
      fetch: async () => {
        fetchCalls += 1;
        if (!upstreamAvailable) return new Response("temporary", { status: 503 });
        return new Response(
          "<response><docs><doc><bookname>마지막 정상 책</bookname><isbn13>9780000000001</isbn13></doc></docs></response>"
        );
      }
    });

    await client.searchBooks("장애 테스트");
    now = 2;
    upstreamAvailable = false;
    const firstContext = createRequestContext("failure-1");
    const staleBooks = await runWithRequestContext(firstContext, () => client.searchBooks("장애 테스트"));

    assert.equal(staleBooks[0]?.title, "마지막 정상 책");
    assert.equal(firstContext.staleNotices.length, 1);
    assert.equal(client.circuitStatus.data4library.state, "open");

    const secondContext = createRequestContext("failure-2");
    const secondStaleBooks = await runWithRequestContext(secondContext, () => client.searchBooks("장애 테스트"));
    assert.equal(secondStaleBooks[0]?.title, "마지막 정상 책");
    assert.match(secondContext.staleNotices[0] ?? "", /circuit is open/);
    assert.equal(fetchCalls, 2);

    now = 102;
    await assert.rejects(client.searchBooks("장애 테스트"), CircuitOpenError);
    assert.equal(fetchCalls, 2);
  });

  it("aborts a hung upstream request at the configured timeout", async () => {
    const client = new Data4LibraryClient(config({ requestTimeoutMs: 5 }), {
      fetch: async (_input, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      })
    });

    await assert.rejects(client.searchBooks("timeout"), UpstreamTimeoutError);
  });
});
