import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CircuitBreaker,
  CircuitOpenError,
  UpstreamHttpError,
  isRetryableUpstreamError,
  withRetry
} from "../src/resilience.js";

describe("retry policy", () => {
  it("uses bounded exponential backoff for transient failures", async () => {
    let attempts = 0;
    const delays: number[] = [];
    const result = await withRetry(async () => {
      attempts += 1;
      if (attempts < 3) throw new UpstreamHttpError("temporary", 503);
      return "ok";
    }, {
      maxAttempts: 3,
      baseDelayMs: 100,
      shouldRetry: isRetryableUpstreamError,
      sleep: async (delayMs) => { delays.push(delayMs); }
    });

    assert.equal(result, "ok");
    assert.equal(attempts, 3);
    assert.deepEqual(delays, [100, 200]);
  });

  it("does not retry daily quota-style 429 responses without Retry-After", async () => {
    let attempts = 0;
    await assert.rejects(withRetry(async () => {
      attempts += 1;
      throw new UpstreamHttpError("quota exhausted", 429);
    }, {
      maxAttempts: 3,
      baseDelayMs: 100,
      shouldRetry: isRetryableUpstreamError,
      sleep: async () => undefined
    }), /quota exhausted/);
    assert.equal(attempts, 1);
  });
});

describe("CircuitBreaker", () => {
  it("opens after repeated failures and closes after a successful half-open probe", async () => {
    let now = 0;
    let calls = 0;
    const breaker = new CircuitBreaker("data4library", {
      failureThreshold: 2,
      resetAfterMs: 1000,
      now: () => now
    });
    const fail = async () => {
      calls += 1;
      throw new Error("upstream failure");
    };

    await assert.rejects(breaker.execute(fail, () => true), /upstream failure/);
    await assert.rejects(breaker.execute(fail, () => true), /upstream failure/);
    await assert.rejects(breaker.execute(fail, () => true), CircuitOpenError);
    assert.equal(calls, 2);
    assert.equal(breaker.snapshot().state, "open");

    now = 1001;
    const result = await breaker.execute(async () => {
      calls += 1;
      return "recovered";
    }, () => true);
    assert.equal(result, "recovered");
    assert.equal(breaker.snapshot().state, "closed");
    assert.equal(breaker.snapshot().consecutiveFailures, 0);
  });
});
