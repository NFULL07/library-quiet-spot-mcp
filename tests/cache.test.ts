import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TtlCache } from "../src/cache.js";

describe("TtlCache", () => {
  it("keeps expired fresh data available only inside the stale retention window", () => {
    let now = 0;
    const cache = new TtlCache<string>(100, {
      staleTtlMs: 200,
      maxSize: 10,
      now: () => now
    });

    cache.set("book", "cached");
    assert.equal(cache.get("book"), "cached");

    now = 101;
    assert.equal(cache.get("book"), undefined);
    assert.equal(cache.getStale("book")?.value, "cached");

    now = 301;
    assert.equal(cache.getStale("book"), undefined);
    assert.equal(cache.size, 0);
  });

  it("evicts the least recently used entry when max size is reached", () => {
    let now = 0;
    const cache = new TtlCache<string>(1000, {
      staleTtlMs: 1000,
      maxSize: 2,
      now: () => now
    });

    cache.set("a", "A");
    now += 1;
    cache.set("b", "B");
    assert.equal(cache.get("a"), "A");

    now += 1;
    cache.set("c", "C");

    assert.equal(cache.get("b"), undefined);
    assert.equal(cache.get("a"), "A");
    assert.equal(cache.get("c"), "C");
    assert.equal(cache.size, 2);
  });

  it("prunes stale-expired entries during writes and size inspection", () => {
    let now = 0;
    const cache = new TtlCache<number>(10, {
      staleTtlMs: 10,
      maxSize: 10,
      now: () => now
    });
    cache.set("old", 1);
    now = 21;
    cache.set("new", 2);

    assert.equal(cache.size, 1);
    assert.equal(cache.get("new"), 2);
  });
});
