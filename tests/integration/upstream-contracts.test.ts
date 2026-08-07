import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AppConfig } from "../../src/config.js";
import { Data4LibraryClient } from "../../src/data4library.js";

const config: AppConfig = {
  port: 3000,
  authKey: "data4library-test-key",
  kakaoRestApiKey: "kakao-test-key",
  aladinTtbKey: "aladin-test-key",
  cacheTtlMs: 1000,
  cacheStaleTtlMs: 1000,
  cacheMaxEntries: 50,
  requestTimeoutMs: 1000,
  logLevel: "error",
  upstreamMaxAttempts: 1,
  upstreamRetryBaseMs: 1,
  circuitFailureThreshold: 5,
  circuitResetMs: 1000
};

describe("upstream adapter contracts", () => {
  it("parses Data4Library XML and sends the documented query contract", async () => {
    let requestedUrl: URL | undefined;
    const client = new Data4LibraryClient(config, {
      fetch: async (input) => {
        requestedUrl = new URL(String(input));
        return new Response([
          "<response><result>",
          "<hasBook>Y</hasBook><loanAvailable>N</loanAvailable>",
          "</result></response>"
        ].join(""), { status: 200, headers: { "content-type": "application/xml" } });
      }
    });

    const result = await client.getBookExist("111001", "9788936434267");

    assert.deepEqual(result, { hasBook: true, loanAvailable: false, rawStatus: "Y N" });
    assert.equal(requestedUrl?.pathname, "/api/bookExist");
    assert.equal(requestedUrl?.searchParams.get("authKey"), "data4library-test-key");
    assert.equal(requestedUrl?.searchParams.get("libCode"), "111001");
    assert.equal(requestedUrl?.searchParams.get("isbn13"), "9788936434267");
  });

  it("sends the KakaoAK header and normalizes Kakao Local coordinates", async () => {
    let authorization = "";
    const client = new Data4LibraryClient(config, {
      fetch: async (_input, init) => {
        authorization = new Headers(init?.headers).get("authorization") ?? "";
        return Response.json({
          documents: [{
            place_name: "대전역",
            address_name: "대전광역시 동구 정동",
            road_address_name: "대전광역시 동구 중앙로 215",
            x: "127.4342",
            y: "36.3321"
          }]
        });
      }
    });

    const places = await client.searchPlace("대전역");

    assert.equal(authorization, "KakaoAK kakao-test-key");
    assert.deepEqual(places[0], {
      name: "대전역",
      address: "대전광역시 동구 정동",
      roadAddress: "대전광역시 동구 중앙로 215",
      latitude: 36.3321,
      longitude: 127.4342
    });
  });

  it("normalizes an Aladin ISBN lookup without leaking raw response fields", async () => {
    const client = new Data4LibraryClient(config, {
      fetch: async () => Response.json({
        item: [{
          title: "아몬드",
          author: "손원평",
          publisher: "창비",
          pubDate: "2017-03-31",
          isbn13: "9788936434267",
          description: "소설",
          cover: "https://example.test/cover.jpg",
          link: "https://example.test/book",
          categoryName: "국내도서>소설",
          bestRank: 7,
          privateField: "must not escape"
        }]
      })
    });

    const book = await client.getAladinBookByIsbn("9788936434267");

    assert.equal(book?.title, "아몬드");
    assert.equal(book?.bestRank, 7);
    assert.equal("privateField" in (book ?? {}), false);
  });
});
