import { performance } from "node:perf_hooks";

const targetUrl = process.env.LOAD_TEST_URL ?? "http://127.0.0.1:3000/mcp";
const totalRequests = positiveInt("LOAD_TEST_REQUESTS", 40);
const concurrency = Math.min(totalRequests, positiveInt("LOAD_TEST_CONCURRENCY", 5));
const p95LimitMs = positiveInt("LOAD_TEST_P95_LIMIT_MS", 2000);
const durations = [];
const failures = [];
let nextRequest = 0;

const startedAt = performance.now();
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (true) {
    const requestNumber = nextRequest;
    nextRequest += 1;
    if (requestNumber >= totalRequests) return;

    const requestStartedAt = performance.now();
    try {
      const response = await fetch(targetUrl, {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
          "x-request-id": `load-${requestNumber}`
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: requestNumber + 1,
          method: "tools/list",
          params: {}
        })
      });
      await response.text();
      if (!response.ok) failures.push({ requestNumber, status: response.status });
    } catch (error) {
      failures.push({
        requestNumber,
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      durations.push(performance.now() - requestStartedAt);
    }
  }
}));

durations.sort((a, b) => a - b);
const elapsedMs = performance.now() - startedAt;
const summary = {
  targetUrl,
  totalRequests,
  concurrency,
  succeeded: totalRequests - failures.length,
  failed: failures.length,
  throughputPerSecond: round(totalRequests / (elapsedMs / 1000)),
  latencyMs: {
    p50: round(percentile(durations, 0.5)),
    p95: round(percentile(durations, 0.95)),
    p99: round(percentile(durations, 0.99)),
    max: round(durations.at(-1) ?? 0)
  },
  p95LimitMs
};

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
if (failures.length > 0) {
  process.stderr.write(`${JSON.stringify({ sampleFailures: failures.slice(0, 5) }, null, 2)}\n`);
  process.exitCode = 1;
} else if (summary.latencyMs.p95 > p95LimitMs) {
  process.stderr.write(`p95 latency ${summary.latencyMs.p95}ms exceeded ${p95LimitMs}ms\n`);
  process.exitCode = 1;
}

function positiveInt(name, fallback) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function percentile(values, ratio) {
  if (values.length === 0) return 0;
  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * ratio) - 1));
  return values[index] ?? 0;
}

function round(value) {
  return Math.round(value * 100) / 100;
}
