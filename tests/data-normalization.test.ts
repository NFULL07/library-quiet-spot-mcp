import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findData4LibraryError,
  haversineKm,
  normalizeLibrary,
  parseBooleanLike
} from "../src/data4library.js";

describe("Data4Library normalization", () => {
  it("normalizes alternate library field names and valid coordinates", () => {
    assert.deepEqual(normalizeLibrary({
      libraryCode: "123",
      libraryName: "테스트도서관",
      addr: "서울특별시 테스트구",
      phone: "02-000-0000",
      libOperatingTime: "09:00-18:00",
      regularClosed: "월요일",
      mapY: "37.5",
      mapX: "127.0"
    }), {
      code: "123",
      name: "테스트도서관",
      address: "서울특별시 테스트구",
      tel: "02-000-0000",
      homepage: "",
      operatingTime: "09:00-18:00",
      closedDays: "월요일",
      latitude: 37.5,
      longitude: 127
    });
  });

  it("evaluates negative Korean availability states before positive substrings", () => {
    assert.equal(parseBooleanLike("소장"), true);
    assert.equal(parseBooleanLike("대출가능"), true);
    assert.equal(parseBooleanLike("미소장"), false);
    assert.equal(parseBooleanLike("대출불가능"), false);
    assert.equal(parseBooleanLike("대출중"), false);
    assert.equal(parseBooleanLike("확인 필요"), undefined);
  });

  it("detects application-level API errors returned with HTTP 200", () => {
    assert.equal(
      findData4LibraryError({ response: { resultCode: "500", resultMsg: "1일 호출량 초과" } }),
      "500 1일 호출량 초과"
    );
    assert.equal(findData4LibraryError({ response: { resultCode: "00", resultMsg: "정상" } }), undefined);
  });

  it("computes realistic great-circle distances", () => {
    const distance = haversineKm(37.5563, 126.9236, 37.5665, 126.9780);
    assert.ok(distance > 4 && distance < 6);
  });
});
