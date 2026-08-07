import assert from "node:assert/strict";
import { it } from "node:test";
import { AppConfig } from "../src/config.js";
import { Data4LibraryClient } from "../src/data4library.js";
import { createRequestContext, runWithRequestContext } from "../src/request-context.js";

it("keeps stale fallback notices isolated across concurrent requests", async () => {
  const failingTitles = new Set<string>();
  const config: AppConfig = {
    port: 3000,
    authKey: "test-key",
    cacheTtlMs: 1,
    requestTimeoutMs: 1000
  };
  const client = new Data4LibraryClient(config, {
    fetch: async (input) => {
      const url = new URL(String(input));
      const title = url.searchParams.get("title") ?? "";
      if (failingTitles.has(title)) {
        return new Response("temporary failure", { status: 503 });
      }
      return new Response([
        "<response><docs><doc>",
        `<bookname>${title}</bookname><isbn13>${title === "A" ? "9780000000001" : "9780000000002"}</isbn13>`,
        "</doc></docs></response>"
      ].join(""), { status: 200, headers: { "content-type": "application/xml" } });
    }
  });

  await client.searchBooks("A");
  await client.searchBooks("B");
  await new Promise((resolve) => setTimeout(resolve, 5));
  failingTitles.add("A");

  const contextA = createRequestContext("request-a");
  const contextB = createRequestContext("request-b");
  const [booksA, booksB] = await Promise.all([
    runWithRequestContext(contextA, () => client.searchBooks("A")),
    runWithRequestContext(contextB, () => client.searchBooks("B"))
  ]);

  assert.equal(booksA[0]?.title, "A");
  assert.equal(booksB[0]?.title, "B");
  assert.equal(contextA.staleNotices.length, 1);
  assert.match(contextA.staleNotices[0] ?? "", /srchBooks/);
  assert.deepEqual(contextB.staleNotices, []);
});
