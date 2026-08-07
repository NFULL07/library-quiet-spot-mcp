import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { createApp } from "../../src/app.js";
import { AppConfig } from "../../src/config.js";
import { createJsonLogger } from "../../src/logger.js";

const config: AppConfig = {
  port: 0,
  cacheTtlMs: 1000,
  cacheStaleTtlMs: 1000,
  cacheMaxEntries: 50,
  requestTimeoutMs: 1000,
  logLevel: "debug",
  upstreamMaxAttempts: 1,
  upstreamRetryBaseMs: 1,
  circuitFailureThreshold: 5,
  circuitResetMs: 1000
};

describe("HTTP request observability", () => {
  const records: Array<Record<string, unknown>> = [];
  const logger = createJsonLogger({
    minimumLevel: "debug",
    write: (line) => records.push(JSON.parse(line) as Record<string, unknown>)
  });
  const server = createApp(config, { logger }).listen(0);
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

  it("preserves a valid caller request ID in the response and completion log", async () => {
    const response = await fetch(`${baseUrl}/health`, {
      headers: { "x-request-id": "portfolio-check-42" }
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-request-id"), "portfolio-check-42");

    await new Promise((resolve) => setImmediate(resolve));
    const record = records.find((item) => item.requestId === "portfolio-check-42");
    assert.equal(record?.event, "http.request.completed");
    assert.equal(record?.path, "/health");
    assert.equal(record?.statusCode, 200);
    assert.equal(typeof record?.durationMs, "number");
  });

  it("replaces an unsafe caller request ID", async () => {
    const response = await fetch(`${baseUrl}/health`, {
      headers: { "x-request-id": "bad id with spaces" }
    });
    const requestId = response.headers.get("x-request-id") ?? "";
    assert.match(requestId, /^[0-9a-f-]{36}$/);
    assert.notEqual(requestId, "bad id with spaces");
  });
});
