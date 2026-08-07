import assert from "node:assert/strict";
import { it } from "node:test";
import { createJsonLogger } from "../src/logger.js";

it("writes one JSON object per event and normalizes errors", () => {
  const lines: string[] = [];
  const logger = createJsonLogger({
    minimumLevel: "debug",
    write: (line) => lines.push(line),
    now: () => new Date("2026-08-07T00:00:00.000Z")
  });

  logger.info("upstream.failed", {
    requestId: "request-1",
    error: new Error("temporary failure")
  });

  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0] ?? ""), {
    timestamp: "2026-08-07T00:00:00.000Z",
    level: "info",
    event: "upstream.failed",
    requestId: "request-1",
    error: {
      name: "Error",
      message: "temporary failure"
    }
  });
});
