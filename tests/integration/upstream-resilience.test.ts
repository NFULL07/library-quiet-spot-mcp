import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AppConfig } from "../../src/config.js";
import { Data4LibraryClient } from "../../src/data4library.js";
import { createJsonLogger } from "../../src/logger.js";
import { CircuitOpenError } from "../../src/resilience.js";
import { createRequestContext, runWithRequestContext } from "../../src/request-context.js";

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 3000,
    authKey: "test-key",
    cacheTtlMs: 1000,
    cacheStaleTtlMs: 1000,
    cacheMaxEntries: 50,
    requestTimeoutMs: 1000,
    logLevel: "debug",
    upstreamMaxAttempts: 2,
    upstreamRetryBaseMs: 10,
    circuitFailureThreshold: 2,
    circuitResetMs: 1000,
    allowedHosts: ["localhost", "127.0.0.1"],
    allowedOrigins: ["https://playmcp.kakao.com"],
    trustProxyHops: 0,
    rateLimitWindowMs: 60000,
    rateLimitMaxRequests: 100,
    ...overrides
  };
}

describe("Data4Library upstream resilience", () => {
  it("retries one transient 503 and preserves request ID in the retry log", async () => {
    let fetchCalls = 0;
    const delays: number[] = [];
    const records: Array<Record<string, unknown>> = [];
    const logger = createJsonLogger({
      minimumLevel: "debug",
      write: (line) => records.push(JSON.parse(line) as Record<string, unknown>)
    });
    const client = new Data4LibraryClient(config(), {
      logger,
      sleep: async (delayMs) => { delays.push(delayMs); },
      fetch: async () => {
        fetchCalls += 1;
        if (fetchCalls === 1) return new Response("temporary", { status: 503 });
        return new Response(
          "<response><docs><doc><bookname>재시도 성공</bookname><isbn13>9780000000001</isbn13></doc></docs></response>",
          { status: 200 }
        );
      }
    });
    const context = createRequestContext("retry-request");

    const books = await runWithRequestContext(context, () => client.searchBooks("재시도"));

    assert.equal(books[0]?.title, "재시도 성공");
    assert.equal(fetchCalls, 2);
    assert.deepEqual(delays, [10]);
    const retryLog = records.find((record) => record.event === "upstream.retry.scheduled");
    assert.equal(retryLog?.requestId, "retry-request");
    assert.equal(retryLog?.provider, "data4library");
    assert.equal(retryLog?.nextAttempt, 2);
  });

  it("opens the circuit for repeated application-level quota failures", async () => {
    let fetchCalls = 0;
    const records: Array<Record<string, unknown>> = [];
    const logger = createJsonLogger({
      minimumLevel: "debug",
      write: (line) => records.push(JSON.parse(line) as Record<string, unknown>)
    });
    const client = new Data4LibraryClient(config({ upstreamMaxAttempts: 1 }), {
      logger,
      fetch: async () => {
        fetchCalls += 1;
        return new Response("<response><error>1일 500건 이상 요청 시 IP 등록이 필요합니다.</error></response>");
      }
    });

    await assert.rejects(client.searchBooks("quota-a"), /500건/);
    await assert.rejects(client.searchBooks("quota-b"), /500건/);
    await assert.rejects(client.searchBooks("quota-c"), CircuitOpenError);

    assert.equal(fetchCalls, 2);
    assert.equal(client.circuitStatus.data4library.state, "open");
    assert.ok(records.some((record) => (
      record.event === "upstream.circuit.opened" && record.provider === "data4library"
    )));
  });
});
