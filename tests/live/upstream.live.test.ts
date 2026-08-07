import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AppConfig } from "../../src/config.js";
import { Data4LibraryClient } from "../../src/data4library.js";

const liveEnabled = process.env.RUN_LIVE_API_TESTS === "1";
const liveConfig: AppConfig = {
  port: 3000,
  authKey: process.env.DATA4LIBRARY_AUTH_KEY,
  kakaoRestApiKey: process.env.KAKAO_REST_API_KEY,
  aladinTtbKey: process.env.ALADIN_TTB_KEY,
  cacheTtlMs: 1000,
  cacheStaleTtlMs: 1000,
  cacheMaxEntries: 50,
  requestTimeoutMs: 10000
};

describe("live upstream smoke tests", { skip: !liveEnabled }, () => {
  it("queries Data4Library", { skip: !liveConfig.authKey }, async () => {
    const books = await new Data4LibraryClient(liveConfig).searchBooks("아몬드");
    assert.ok(books.length > 0);
  });

  it("queries Kakao Local", { skip: !liveConfig.kakaoRestApiKey }, async () => {
    const places = await new Data4LibraryClient(liveConfig).searchPlace("대전역");
    assert.ok(places.length > 0);
  });

  it("queries Aladin OpenAPI", { skip: !liveConfig.aladinTtbKey }, async () => {
    const books = await new Data4LibraryClient(liveConfig).searchAladinBooks("아몬드", 1);
    assert.ok(books.length > 0);
  });
});
