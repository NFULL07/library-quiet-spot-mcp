import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BookSummary, LibrarySummary, TrendPoint } from "../src/data4library.js";
import {
  interestKdcCodes,
  isComicLikeBook,
  resolveChildReadingProfile,
  scoreInterestMatch
} from "../src/services/child-recommendation.js";
import {
  buildOperatingHourVisitCandidates,
  inferRegionCodeFromAddress,
  rankQuietPoints
} from "../src/services/library-visit.js";
import { selectBestLibraryMatch } from "../src/services/resolvers.js";

const baseBook: BookSummary = {
  title: "어린이를 위한 우주 이야기",
  authors: "테스트 작가",
  publisher: "테스트 출판사",
  publicationYear: "2026",
  isbn13: "9780000000001",
  volume: "",
  imageUrl: "",
  classNo: "443",
  className: "천문학"
};

function library(name: string, code: string): LibrarySummary {
  return {
    code,
    name,
    address: "",
    tel: "",
    homepage: "",
    operatingTime: "",
    closedDays: ""
  };
}

describe("child reading profile", () => {
  it("maps natural Korean age and grade expressions to Data4Library age groups", () => {
    assert.deepEqual(resolveChildReadingProfile(undefined, "7살"), { label: "7살", ageGroupCode: "6" });
    assert.deepEqual(resolveChildReadingProfile(undefined, "초등학교 3학년"), {
      label: "초등학교 3학년",
      ageGroupCode: "8"
    });
    assert.deepEqual(resolveChildReadingProfile(undefined, "중1"), { label: "중1", ageGroupCode: "14" });
    assert.deepEqual(resolveChildReadingProfile(45, undefined), { label: "45살", ageGroupCode: "40" });
  });

  it("uses KDC categories as the primary interest matching signal", () => {
    assert.deepEqual(interestKdcCodes(["과학", "역사", "우주"]), ["4", "9"]);
    assert.equal(scoreInterestMatch(baseBook, ["과학"]), 120);
    assert.equal(scoreInterestMatch(baseBook, ["미술"]), 0);
  });

  it("detects comic-like books from both classification and title metadata", () => {
    assert.equal(isComicLikeBook({ ...baseBook, title: "흔한남매의 과학 만화" }), true);
    assert.equal(isComicLikeBook({ ...baseBook, classNo: "657" }), true);
    assert.equal(isComicLikeBook(baseBook), false);
  });
});

describe("library and visit rules", () => {
  it("selects one exact normalized library name without guessing ambiguous candidates", () => {
    const libraries = [library("서울특별시교육청 정독도서관", "111001"), library("정독 작은도서관", "111002")];
    assert.equal(selectBestLibraryMatch("서울특별시교육청 정독도서관", libraries)?.code, "111001");

    const tiedCandidates = [library("정독A도서관", "111003"), library("정독B도서관", "111004")];
    assert.equal(selectBestLibraryMatch("정독", tiedCandidates), undefined);
  });

  it("ranks lower observed usage counts as quieter percentiles", () => {
    const points: TrendPoint[] = [
      { label: "10시", count: 30, bucket: "hour" },
      { label: "11시", count: 10, bucket: "hour" },
      { label: "12시", count: 20, bucket: "hour" }
    ];
    const ranked = rankQuietPoints(points);
    assert.deepEqual(ranked.map((point) => point.label), ["11시", "12시", "10시"]);
    assert.deepEqual(ranked.map((point) => point.percentile), [0, 50, 100]);
  });

  it("derives bounded visit candidates from the longest operating-time range", () => {
    const candidates = buildOperatingHourVisitCandidates("평일 09:00-18:00 / 주말 09:00-13:00");
    assert.deepEqual(candidates.map((candidate) => [candidate.label, candidate.time]), [
      ["개관 직후", "09:00-10:30"],
      ["중간 시간대", "12:30-14:00"],
      ["폐관 전 여유 구간", "16:00-17:30"]
    ]);
  });

  it("infers Data4Library region codes from full Korean addresses", () => {
    assert.equal(inferRegionCodeFromAddress("대전광역시 동구 중앙로 200"), "25");
    assert.equal(inferRegionCodeFromAddress("제주특별자치도 제주시"), "39");
    assert.equal(inferRegionCodeFromAddress("주소 미상"), undefined);
  });
});
