import { BookExistResult, BookSummary, Data4LibraryClient, LibrarySummary, NearbyLibrary, PlaceSummary, TrendPoint, UsageAnalysis } from "../data4library.js";
import { markdownTable } from "../text.js";
import { normalizeAuthorKey, normalizeLookupText, resolveSingleBook, resolveSingleLibrary } from "./resolvers.js";

export async function findNearbyLibraries(
  client: Data4LibraryClient,
  placeName: string | undefined,
  latitude: number | undefined,
  longitude: number | undefined,
  radiusKm: number | undefined,
  limit: number | undefined
): Promise<string> {
  let resolvedPlace: PlaceSummary | undefined;
  let resolvedLatitude = latitude;
  let resolvedLongitude = longitude;

  if (placeName && (resolvedLatitude === undefined || resolvedLongitude === undefined)) {
    const places = await client.searchPlace(placeName);
    resolvedPlace = places[0];
    if (!resolvedPlace) {
      return [
        "## 장소를 찾을 수 없습니다",
        "",
        `\`${placeName}\`으로 검색된 장소가 없습니다.`,
        "",
        "장소명을 더 구체적으로 입력하거나 위도/경도를 직접 입력해 주세요."
      ].join("\n");
    }
    resolvedLatitude = resolvedPlace.latitude;
    resolvedLongitude = resolvedPlace.longitude;
  }

  if (resolvedLatitude === undefined || resolvedLongitude === undefined) {
    return [
      "## 주변 도서관을 찾을 수 없습니다",
      "",
      "기준 장소명 또는 현재 위치의 위도/경도를 입력해 주세요.",
      "",
      "- 예: `홍대입구역 근처 도서관 찾아줘`",
      "- 예: `위도 37.5665, 경도 126.9780 주변 도서관 찾아줘`",
      "- 장소명 검색은 `KAKAO_REST_API_KEY`가 설정되어 있어야 합니다."
    ].join("\n");
  }

  if (!isValidLatitude(resolvedLatitude) || !isValidLongitude(resolvedLongitude)) {
    return [
      "## 위치 좌표가 올바르지 않습니다",
      "",
      `- latitude: ${resolvedLatitude}`,
      `- longitude: ${resolvedLongitude}`,
      "- 위도는 -90~90, 경도는 -180~180 범위여야 합니다."
    ].join("\n");
  }

  const safeRadiusKm = clampNumber(radiusKm ?? 5, 1, 30);
  const safeLimit = Math.round(clampNumber(limit ?? 10, 1, 20));
  const libraries = await client.searchNearbyLibraries(resolvedLatitude, resolvedLongitude, safeRadiusKm, safeLimit);

  if (libraries.length === 0) {
    return [
      "## 주변 도서관을 찾지 못했습니다",
      "",
      resolvedPlace ? `- 기준 장소: ${formatPlace(resolvedPlace)}` : "",
      `- 기준 좌표: ${resolvedLatitude}, ${resolvedLongitude}`,
      `- 검색 반경: ${safeRadiusKm}km`,
      "",
      "정보나루 도서관 좌표 데이터가 없거나, 검색 반경 안에 좌표가 등록된 도서관이 없을 수 있습니다.",
      "반경을 넓히거나 도서관 이름 검색 도구를 사용해 주세요."
    ].join("\n");
  }

  const rows = libraries.map((library) => {
    const visitCandidate = firstVisitCandidate(library);
    return [
      `${library.distanceKm.toFixed(2)}km`,
      library.name || "-",
      library.address || "-",
      visitCandidate,
      library.closedDays || "-",
      library.code || "-"
    ];
  });

  return [
    "## 내 위치 주변 도서관",
    "",
    resolvedPlace ? `기준 장소: ${formatPlace(resolvedPlace)}` : "",
    `기준 좌표: ${resolvedLatitude}, ${resolvedLongitude}`,
    `검색 반경: ${safeRadiusKm}km`,
    "",
    markdownTable(["거리", "도서관", "주소", "방문 후보", "휴관일", "도서관 코드"], rows),
    "",
    "방문 후보는 정보나루 운영시간을 파싱해 만든 계획용 시간대입니다. 실시간 좌석/혼잡도 값은 아닙니다.",
    "특정 도서관을 골라 `plan_library_reading_visit` 도구로 책 대출 가능 여부와 다음 독서 후보까지 이어서 확인할 수 있습니다."
  ].join("\n");
}

export async function findBestVisitTime(
  client: Data4LibraryClient,
  libraryName: string | undefined,
  libraryCode: string | undefined
): Promise<string> {
  const resolved = await resolveSingleLibrary(client, libraryName, libraryCode);
  if (resolved.kind === "message") return resolved.markdown;

  return renderBestVisitTime(client, resolved.library);
}

export async function planLibraryReadingVisit(
  client: Data4LibraryClient,
  libraryName: string | undefined,
  libraryCode: string | undefined,
  bookTitle: string | undefined,
  isbn: string | undefined
): Promise<string> {
  const [libraryResolved, bookResolved] = await Promise.all([
    resolveSingleLibrary(client, libraryName, libraryCode),
    resolveSingleBook(client, bookTitle, isbn)
  ]);
  if (libraryResolved.kind === "message") return libraryResolved.markdown;
  if (bookResolved.kind === "message") return bookResolved.markdown;

  const library = libraryResolved.library;
  const baseBook = bookResolved.book;
  const [targetExist, analysis, visitMarkdown] = await Promise.all([
    client.getBookExist(library.code, baseBook.isbn13).catch(() => undefined),
    client.getUsageAnalysis(baseBook.isbn13).catch(() => undefined),
    renderBestVisitTime(client, library).catch(() => "")
  ]);

  const companionBooks = collectCompanionBooks(analysis).slice(0, 5);
  const companionChecks = await Promise.all(
    companionBooks.map(async (item) => ({
      ...item,
      exist: item.book.isbn13
        ? await client.getBookExist(library.code, item.book.isbn13).catch(() => undefined)
        : undefined
    }))
  );

  const targetRows = [[
    formatBookTitle(baseBook),
    formatExistStatus(targetExist?.hasBook),
    formatLoanStatus(targetExist?.loanAvailable),
    targetExist?.rawStatus || "정보나루 bookExist 응답을 확인하지 못했습니다."
  ]];

  const companionRows = companionChecks.map((item) => [
    item.source,
    formatBookTitle(item.book),
    item.book.authors || "-",
    formatExistStatus(item.exist?.hasBook),
    formatLoanStatus(item.exist?.loanAvailable)
  ]);

  return [
    "## 도서관 독서 방문 플랜",
    "",
    `대상 도서관: ${formatLibrary(library)}`,
    `기준 도서: ${formatBookTitle(baseBook)}`,
    "",
    "## 1. 이 책을 빌리러 가도 될까?",
    "",
    markdownTable(["도서", "소장 여부", "대출 가능 여부", "응답 근거"], targetRows),
    "",
    "## 2. 같이 빌릴 다음 책 후보",
    "",
    companionRows.length > 0
      ? markdownTable(["추천 근거", "도서", "저자", "소장 여부", "대출 가능 여부"], companionRows)
      : "- 정보나루 이용분석 응답에 함께 추천할 책이 없습니다.",
    "",
    "## 3. 방문 시간",
    "",
    summarizeVisitMarkdown(visitMarkdown),
    "",
    "이 도구는 단순 소장 검색이 아니라, 기준 책의 대출 가능 여부와 다음 독서 후보의 같은 도서관 소장 여부를 한 번에 묶어 방문 계획으로 정리합니다."
  ].join("\n");
}

export async function renderBestVisitTime(
  client: Data4LibraryClient,
  library: LibrarySummary
): Promise<string> {
  const [dayPoints, hourPoints] = await Promise.all([
    client.getUsageTrend(library.code, "D"),
    client.getUsageTrend(library.code, "H")
  ]);

  const allPoints = [...dayPoints, ...hourPoints];
  if (allPoints.length === 0) {
    return renderVisitTimeFallback(library);
  }

  const ranked = rankQuietPoints(allPoints).slice(0, 3);
  const rows = ranked.map((point, index) => [
    String(index + 1),
    point.bucket === "day" ? "요일" : point.bucket === "hour" ? "시간대" : "구간",
    point.label,
    `${point.percentile.toFixed(1)}%`,
    String(point.count)
  ]);

  const daySummary = summarizePoints(dayPoints, "요일별");
  const hourSummary = summarizePoints(hourPoints, "시간대별");

  return [
    "## 한산한 방문 시간 TOP 3",
    "",
    `대상 도서관: ${formatLibrary(library)}`,
    "",
    markdownTable(["순위", "구분", "값", "상대 혼잡도", "대출/반납 지표"], rows),
    "",
    "상대 혼잡도는 같은 응답 묶음 안에서 낮은 지표일수록 한산하다고 보고 백분위로 계산했습니다.",
    "",
    daySummary,
    hourSummary
  ].filter(Boolean).join("\n");
}

export async function findTrendingBooksAndLibraryMatch(
  client: Data4LibraryClient,
  region: string | undefined,
  ageGroup: string | undefined,
  libraryName: string | undefined,
  libraryCode: string | undefined
): Promise<string> {
  const resolved = await resolveSingleLibrary(client, libraryName, libraryCode);
  if (resolved.kind === "message") return resolved.markdown;

  const library = resolved.library;
  const effectiveRegion = region ?? inferRegionCodeFromAddress(library.address);
  const [popularResult, visitMarkdown] = await Promise.all([
    client.getPopularBooks(effectiveRegion, ageGroup)
      .then((books) => ({ ok: true as const, books }))
      .catch((error: unknown) => ({ ok: false as const, error })),
    renderBestVisitTime(client, library).catch(() => "")
  ]);

  if (!popularResult.ok) {
    return [
      "## 인기 도서 소장 매칭",
      "",
      `대상 도서관: ${formatLibrary(library)}`,
      effectiveRegion ? `- 추론한 지역 코드: \`${effectiveRegion}\`` : "- 지역 코드: 확인되지 않음",
      "",
      "인기 도서 데이터를 불러오지 못했습니다.",
      "",
      `- 원인: ${popularResult.error instanceof Error ? popularResult.error.message : String(popularResult.error)}`,
      "- 정보나루 인기대출 API 응답을 기반으로만 답해야 하므로 대체 목록을 만들지 않습니다."
    ].join("\n");
  }

  const popularBooks = popularResult.books;

  if (popularBooks.length === 0) {
    return [
      "## 인기 도서 소장 매칭",
      "",
      "조건에 맞는 인기 도서 데이터를 찾지 못했습니다.",
      "",
      effectiveRegion ? `- 지역 코드: \`${effectiveRegion}\`` : "- 지역 코드: 전체",
      ageGroup ? `- 연령 코드: \`${ageGroup}\`` : "- 연령 코드: 전체",
      `- 도서관: ${formatLibrary(library)}`
    ].join("\n");
  }

  const checks = await Promise.all(
    popularBooks.slice(0, 5).map(async (book) => ({
      book,
      exist: book.isbn13
        ? await client.getBookExist(library.code, book.isbn13).catch(() => undefined)
        : undefined
    }))
  );

  const rows = checks.map(({ book, exist }, index) => [
    String(book.ranking ?? index + 1),
    formatBookTitle(book),
    book.authors || "-",
    book.isbn13 || "-",
    exist?.hasBook === true ? "소장" : exist?.hasBook === false ? "미소장" : "확인 필요",
    exist?.loanAvailable === true ? "가능" : exist?.loanAvailable === false ? "불가" : "도서관 확인"
  ]);

  const visitSummary = summarizeVisitMarkdown(visitMarkdown);

  return [
    "## 인기 도서 소장 매칭",
    "",
    `대상 도서관: ${formatLibrary(library)}`,
    effectiveRegion ? `지역 코드: \`${effectiveRegion}\` (지역 결과가 없으면 전국 인기대출로 보완)` : "지역 코드: 전체",
    "",
    markdownTable(["인기 순위", "도서", "저자", "ISBN", "소장 여부", "대출 가능 여부"], rows),
    "",
    "대출 가능 여부 필드가 명확하지 않은 응답은 `도서관 확인`으로 표시했습니다. 없는 값을 지어내지 않습니다.",
    "",
    "## 추천 방문 시간",
    "",
    visitSummary
  ].join("\n");
}

export async function generateReadingRoadmap(
  client: Data4LibraryClient,
  bookTitle: string | undefined,
  isbn: string | undefined
): Promise<string> {
  const resolved = await resolveSingleBook(client, bookTitle, isbn);
  if (resolved.kind === "message") return resolved.markdown;

  const baseBook = resolved.book;
  const analysis = await client.getUsageAnalysis(baseBook.isbn13);
  const sections = [
    {
      title: "함께 읽힌 책 (coLoanBooks)",
      subtitle: "실제 동시 대출 데이터 기반",
      books: analysis.coLoanBooks
    },
    {
      title: "같은 결의 다음 책 (maniaRecBooks)",
      subtitle: "마니아 추천 데이터 기반",
      books: analysis.maniaRecBooks
    },
    {
      title: "요즘 다독자들의 다음 선택 (readerRecBooks)",
      subtitle: "다독자 추천 데이터 기반",
      books: analysis.readerRecBooks
    }
  ];

  const seenIsbn = new Set<string>();
  const renderedSections = sections.map((section) => {
    const books = section.books.filter((book) => {
      if (!book.isbn13) return true;
      if (seenIsbn.has(book.isbn13)) return false;
      seenIsbn.add(book.isbn13);
      return true;
    });
    return renderBookSection(section.title, section.subtitle, books);
  });

  const hasAnyRecommendation = sections.some((section) => section.books.length > 0);
  if (!analysis.book && !hasAnyRecommendation) {
    return [
      "## 독서 로드맵",
      "",
      "이 책은 분석 데이터가 부족합니다.",
      "",
      `- ${formatBookTitle(baseBook)}`,
      "- 정보나루 usageAnalysisList 응답에 추천 도서 데이터가 없으므로 임의 추천을 생성하지 않습니다."
    ].join("\n");
  }

  const header = analysis.book
    ? [
        "## 기준 도서",
        "",
        `- ${formatBookTitle(analysis.book)}`,
        analysis.book.authors ? `- 저자: ${analysis.book.authors}` : "",
        analysis.book.loanCount !== undefined ? `- 누적 대출 횟수: ${analysis.book.loanCount}` : ""
      ].filter(Boolean).join("\n")
    : ["## 기준 도서", "", `- ${formatBookTitle(baseBook)}`].join("\n");

  const keywordLine = analysis.keywords
    .slice(0, 10)
    .map((keyword) => keyword.word)
    .filter(Boolean)
    .join(", ");

  return [
    header,
    keywordLine ? `\n주요 키워드: ${keywordLine}` : "",
    "",
    ...renderedSections
  ].join("\n");
}

export function rankQuietPoints(points: TrendPoint[]): Array<TrendPoint & { percentile: number }> {
  const sortedCounts = [...points].map((point) => point.count).sort((a, b) => a - b);
  const maxIndex = Math.max(sortedCounts.length - 1, 1);
  return points
    .map((point) => {
      const lowerOrEqual = sortedCounts.filter((count) => count <= point.count).length - 1;
      return {
        ...point,
        percentile: (lowerOrEqual / maxIndex) * 100
      };
    })
    .sort((a, b) => a.percentile - b.percentile || a.count - b.count);
}

function summarizePoints(points: TrendPoint[], title: string): string {
  if (points.length === 0) return "";
  const ranked = rankQuietPoints(points).slice(0, 5);
  const values = ranked.map((point) => `${point.label}(${point.percentile.toFixed(1)}%)`).join(", ");
  return `- ${title} 한산 후보: ${values}`;
}

export function collectCompanionBooks(analysis: UsageAnalysis | undefined): Array<{ source: string; book: BookSummary }> {
  if (!analysis) return [];

  const groups: Array<{ source: string; books: BookSummary[] }> = [
    {
      source: "함께 대출",
      books: analysis.coLoanBooks
    },
    {
      source: "마니아 추천",
      books: analysis.maniaRecBooks
    },
    {
      source: "다독자 추천",
      books: analysis.readerRecBooks
    }
  ];

  const seen = new Set<string>();
  const result: Array<{ source: string; book: BookSummary }> = [];
  for (const group of groups) {
    for (const book of group.books) {
      const key = book.isbn13 || `${normalizeLookupText(book.title)}:${normalizeAuthorKey(book.authors)}`;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      result.push({ source: group.source, book });
    }
  }
  return result;
}

export function formatExistStatus(value: BookExistResult["hasBook"]): string {
  if (value === true) return "소장";
  if (value === false) return "미소장";
  return "확인 필요";
}

export function formatLoanStatus(value: BookExistResult["loanAvailable"]): string {
  if (value === true) return "가능";
  if (value === false) return "불가";
  return "도서관 확인";
}

export function summarizeVisitMarkdown(markdown: string): string {
  if (!markdown.trim()) {
    return "- 방문 시간 정보는 확인하지 못했습니다.";
  }

  if (markdown.includes("## 운영시간 기반 방문 후보")) {
    const lines = markdown.split("\n");
    const tableStart = lines.findIndex((line) => line.startsWith("| 후보 |"));
    if (tableStart !== -1) {
      return [
        "실측 혼잡도 대신 운영시간으로 계산한 방문 후보입니다.",
        "",
        ...lines.slice(tableStart, tableStart + 5)
      ].join("\n");
    }
    return "- 실측 혼잡도 대신 운영시간으로 방문 후보를 계산했습니다.";
  }

  const lines = markdown.split("\n");
  const tableStart = lines.findIndex((line) => line.startsWith("| 순위 |"));
  if (tableStart === -1) {
    return lines.slice(0, 8).join("\n");
  }

  return [
    ...lines.slice(0, tableStart + 2),
    ...lines.slice(tableStart + 2, tableStart + 5)
  ].join("\n");
}

function renderVisitTimeFallback(library: LibrarySummary): string {
  const candidates = buildOperatingHourVisitCandidates(library.operatingTime);
  const candidateRows = candidates.map((candidate) => [
    candidate.label,
    candidate.time,
    candidate.reason
  ]);
  const infoRows = [
    ["도서관", formatLibrary(library)],
    ["운영시간", library.operatingTime || "정보나루 기본정보 응답에 없음"],
    ["휴관일", library.closedDays || "정보나루 기본정보 응답에 없음"],
    ["전화", library.tel || "정보나루 기본정보 응답에 없음"],
    ["홈페이지", library.homepage || "정보나루 기본정보 응답에 없음"]
  ];

  const candidateBlock = candidateRows.length > 0
    ? [
        markdownTable(["후보", "시간대", "근거"], candidateRows),
        "",
        "위 후보는 실시간 좌석/방문자 수가 아니라 정보나루 운영시간을 기준으로 계산한 방문 계획입니다."
      ].join("\n")
    : [
        "운영시간을 시간대 형식으로 해석하지 못해 자동 방문 후보를 만들 수 없습니다.",
        "아래 기본정보를 확인해 방문 시간을 정해 주세요."
      ].join("\n");

  return [
    "## 운영시간 기반 방문 후보",
    "",
    "정보나루 `usageTrend` 시간대/요일 지표는 제공되지 않았습니다.",
    "그래서 혼잡도를 지어내지 않고, 정보나루 도서관 기본정보의 운영시간을 파싱해 방문 후보를 계산했습니다.",
    "",
    candidateBlock,
    "",
    markdownTable(["항목", "값"], infoRows),
    "",
    "- 실측 혼잡도 순위가 있는 도서관은 `usageTrend` 기반 TOP 3로 표시합니다.",
    "- 실측 혼잡도 데이터가 없는 도서관은 운영시간 기반 방문 후보로 표시합니다.",
    "- 인기 도서 소장 여부와 다음 독서 후보 기능은 `loanItemSrch`, `bookExist`, `usageAnalysisList` 데이터를 별도로 조회합니다."
  ].join("\n");
}

type VisitCandidate = {
  label: string;
  time: string;
  reason: string;
};

type TimeRange = {
  startMinutes: number;
  endMinutes: number;
};

export function buildOperatingHourVisitCandidates(operatingTime: string): VisitCandidate[] {
  const ranges = extractTimeRanges(operatingTime);
  if (ranges.length === 0) return [];

  const mainRange = ranges
    .filter((range) => range.endMinutes > range.startMinutes)
    .sort((a, b) => (b.endMinutes - b.startMinutes) - (a.endMinutes - a.startMinutes))[0];
  if (!mainRange) return [];

  const candidates: VisitCandidate[] = [];
  const openingEnd = Math.min(mainRange.startMinutes + 90, mainRange.endMinutes);
  if (openingEnd > mainRange.startMinutes) {
    candidates.push({
      label: "개관 직후",
      time: `${formatMinutes(mainRange.startMinutes)}-${formatMinutes(openingEnd)}`,
      reason: "운영 시작 직후라 자료 탐색과 좌석 선택 계획을 세우기 좋습니다."
    });
  }

  const duration = mainRange.endMinutes - mainRange.startMinutes;
  if (duration >= 360) {
    const midStart = mainRange.startMinutes + Math.floor(duration * 0.4 / 30) * 30;
    const midEnd = Math.min(midStart + 90, mainRange.endMinutes);
    if (midEnd > midStart) {
      candidates.push({
        label: "중간 시간대",
        time: `${formatMinutes(midStart)}-${formatMinutes(midEnd)}`,
        reason: "개관/폐관 경계 시간을 피한 운영시간 중간 구간입니다."
      });
    }
  }

  const lateStart = Math.max(mainRange.endMinutes - 120, mainRange.startMinutes);
  const lateEnd = Math.max(mainRange.endMinutes - 30, lateStart);
  if (lateEnd > lateStart) {
    candidates.push({
      label: "폐관 전 여유 구간",
      time: `${formatMinutes(lateStart)}-${formatMinutes(lateEnd)}`,
      reason: "폐관 직전 30분은 피하고, 짧은 반납/대출 동선을 잡기 좋은 구간입니다."
    });
  }

  return candidates.slice(0, 3);
}

function extractTimeRanges(text: string): TimeRange[] {
  const ranges: TimeRange[] = [];
  const pattern = /(\d{1,2})\s*(?::|시)\s*(\d{2})?\s*(?:-|~|–|—|부터|－)\s*(\d{1,2})\s*(?::|시)\s*(\d{2})?/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const startHour = Number.parseInt(match[1] ?? "", 10);
    const startMinute = Number.parseInt(match[2] ?? "0", 10);
    const endHour = Number.parseInt(match[3] ?? "", 10);
    const endMinute = Number.parseInt(match[4] ?? "0", 10);
    if (!isValidTime(startHour, startMinute) || !isValidTime(endHour, endMinute)) continue;
    ranges.push({
      startMinutes: startHour * 60 + startMinute,
      endMinutes: endHour * 60 + endMinute
    });
  }
  return ranges;
}

function isValidTime(hour: number, minute: number): boolean {
  return Number.isInteger(hour) && Number.isInteger(minute) && hour >= 0 && hour <= 24 && minute >= 0 && minute < 60;
}

function formatMinutes(totalMinutes: number): string {
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function renderBookSection(title: string, subtitle: string, books: BookSummary[]): string {
  if (books.length === 0) {
    return [`## ${title}`, subtitle, "", "- 제공된 데이터가 없습니다."].join("\n");
  }
  const lines = books.slice(0, 10).map((book) => `- ${formatBookTitle(book)}${book.authors ? ` - ${book.authors}` : ""}`);
  return [`## ${title}`, subtitle, "", ...lines, ""].join("\n");
}

export function formatBookTitle(book: BookSummary): string {
  const volume = book.volume ? ` ${book.volume}` : "";
  const year = book.publicationYear ? ` (${book.publicationYear})` : "";
  const isbn = book.isbn13 ? `, ISBN ${book.isbn13}` : "";
  return `${book.title || "제목 미상"}${volume}${year}${isbn}`;
}

export function formatLibrary(library: LibrarySummary): string {
  const name = library.name || "도서관 이름 미상";
  const code = library.code ? ` (${library.code})` : "";
  const address = library.address ? ` - ${library.address}` : "";
  return `${name}${code}${address}`;
}

export function formatPlace(place: PlaceSummary): string {
  const address = place.roadAddress || place.address;
  return address ? `${place.name} - ${address}` : place.name;
}

function firstVisitCandidate(library: NearbyLibrary): string {
  const [candidate] = buildOperatingHourVisitCandidates(library.operatingTime);
  return candidate ? `${candidate.label} ${candidate.time}` : "운영시간 확인 필요";
}

export function inferRegionCodeFromAddress(address: string): string | undefined {
  const normalized = normalizeLookupText(address);
  const entries: Array<[string, string]> = [
    ["서울", "11"],
    ["부산", "21"],
    ["대구", "22"],
    ["인천", "23"],
    ["광주", "24"],
    ["대전", "25"],
    ["울산", "26"],
    ["세종", "29"],
    ["경기", "31"],
    ["강원", "32"],
    ["충북", "33"],
    ["충청북도", "33"],
    ["충남", "34"],
    ["충청남도", "34"],
    ["전북", "35"],
    ["전라북도", "35"],
    ["전남", "36"],
    ["전라남도", "36"],
    ["경북", "37"],
    ["경상북도", "37"],
    ["경남", "38"],
    ["경상남도", "38"],
    ["제주", "39"]
  ];

  return entries.find(([label]) => normalized.includes(normalizeLookupText(label)))?.[1];
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function isValidLatitude(value: number): boolean {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

export function isValidLongitude(value: number): boolean {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}
