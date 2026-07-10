import { Data4LibraryClient, MissingAuthKeyError, BookSummary, TrendPoint, LibrarySummary } from "./data4library.js";
import { guardMarkdown, markdownTable } from "./text.js";

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: {
    title: string;
    readOnlyHint: boolean;
    destructiveHint: boolean;
    openWorldHint: boolean;
    idempotentHint: boolean;
  };
};

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "find_best_visit_time",
    description:
      "Plans practical library visit windows from Data4Library(도서관 정보나루). Uses usageTrend when available; otherwise derives visit candidates from official operating hours and closed-day data.",
    inputSchema: {
      type: "object",
      properties: {
        library_name: {
          type: "string",
          description: "Library name to search, such as 정독도서관 or 마포중앙도서관."
        },
        library_code: {
          type: "string",
          description: "Optional Data4Library library code. Use this only when the code is already known."
        }
      },
      additionalProperties: false
    },
    annotations: {
      title: "Plan library visit windows",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
      idempotentHint: true
    }
  },
  {
    name: "find_trending_books_and_library_match",
    description:
      "Finds current popular books from Data4Library(도서관 정보나루), checks whether a named library owns them, and adds practical visit-window guidance.",
    inputSchema: {
      type: "object",
      properties: {
        region: {
          type: "string",
          description: "Optional region code used by Data4Library popular-loan search. If omitted, the tool uses the default popular-book search."
        },
        age_group: {
          type: "string",
          description: "Optional age group code used by Data4Library popular-loan search."
        },
        library_name: {
          type: "string",
          description: "Library name to search, such as 정독도서관 or 마포중앙도서관."
        },
        library_code: {
          type: "string",
          description: "Optional Data4Library library code. Use this only when the code is already known."
        }
      },
      additionalProperties: false
    },
    annotations: {
      title: "Match trending books to a library",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
      idempotentHint: true
    }
  },
  {
    name: "generate_data_driven_reading_roadmap",
    description:
      "Builds a measured next-reading roadmap from a book title or ISBN using Data4Library(도서관 정보나루) usageAnalysisList co-loan, mania, and reader recommendation data.",
    inputSchema: {
      type: "object",
      properties: {
        book_title: {
          type: "string",
          description: "Book title to search, such as 아몬드."
        },
        isbn: {
          type: "string",
          description: "Optional ISBN-13 of the book to analyze when already known."
        }
      },
      additionalProperties: false
    },
    annotations: {
      title: "Generate data-driven reading roadmap",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
      idempotentHint: true
    }
  }
];

export async function callTool(
  client: Data4LibraryClient,
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  try {
    switch (name) {
      case "find_best_visit_time":
        return guardMarkdown(
          await findBestVisitTime(
            client,
            optionalString(args, "library_name"),
            optionalString(args, "library_code")
          )
        );
      case "find_trending_books_and_library_match":
        return guardMarkdown(
          await findTrendingBooksAndLibraryMatch(
            client,
            optionalString(args, "region"),
            optionalString(args, "age_group"),
            optionalString(args, "library_name"),
            optionalString(args, "library_code")
          )
        );
      case "generate_data_driven_reading_roadmap":
        return guardMarkdown(
          await generateReadingRoadmap(
            client,
            optionalString(args, "book_title"),
            optionalString(args, "isbn")
          )
        );
      default:
        return `알 수 없는 도구입니다: \`${name}\``;
    }
  } catch (error) {
    return formatToolError(error);
  }
}

async function findBestVisitTime(
  client: Data4LibraryClient,
  libraryName: string | undefined,
  libraryCode: string | undefined
): Promise<string> {
  const resolved = await resolveSingleLibrary(client, libraryName, libraryCode);
  if (resolved.kind === "message") return resolved.markdown;

  return renderBestVisitTime(client, resolved.library);
}

async function renderBestVisitTime(
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

async function findTrendingBooksAndLibraryMatch(
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

type LibraryResolution =
  | { kind: "library"; library: LibrarySummary }
  | { kind: "message"; markdown: string };

async function resolveSingleLibrary(
  client: Data4LibraryClient,
  libraryName: string | undefined,
  libraryCode: string | undefined
): Promise<LibraryResolution> {
  if (libraryCode) {
    return {
      kind: "library",
      library: {
        code: libraryCode,
        name: libraryName ?? "",
        address: "",
        tel: "",
        homepage: "",
        operatingTime: "",
        closedDays: ""
      }
    };
  }

  if (!libraryName) {
    return {
      kind: "message",
      markdown: [
        "## 도서관을 찾을 수 없습니다",
        "",
        "도서관 이름을 입력해 주세요.",
        "",
        "- 예: `정독도서관 한산한 시간 알려줘`",
        "- 예: `마포중앙도서관에 요즘 인기책 있어?`"
      ].join("\n")
    };
  }

  const libraries = await client.searchLibraries(libraryName);
  const selected = selectBestLibraryMatch(libraryName, libraries);
  if (selected) {
    return { kind: "library", library: selected };
  }

  if (libraries.length === 0) {
    return {
      kind: "message",
      markdown: [
        "## 도서관을 찾을 수 없습니다",
        "",
        `\`${libraryName}\`으로 검색된 도서관이 없습니다.`,
        "",
        "도서관 공식 명칭이나 지역명을 조금 더 포함해서 다시 입력해 주세요."
      ].join("\n")
    };
  }

  if (libraries.length > 1) {
    const rows = libraries.slice(0, 10).map((library, index) => [
      String(index + 1),
      library.name || "-",
      library.address || "-",
      library.code || "-"
    ]);
    return {
      kind: "message",
      markdown: [
        "## 도서관 후보가 여러 개입니다",
        "",
        `\`${libraryName}\`으로 여러 도서관이 검색되었습니다. 아래 후보 중 하나의 이름을 더 구체적으로 입력해 주세요.`,
        "",
        markdownTable(["번호", "도서관", "주소", "도서관 코드"], rows)
      ].join("\n")
    };
  }

  return { kind: "library", library: libraries[0] };
}

function selectBestLibraryMatch(query: string, libraries: LibrarySummary[]): LibrarySummary | undefined {
  const normalizedQuery = normalizeLookupText(query);
  const exactMatches = libraries.filter((library) => normalizeLookupText(library.name) === normalizedQuery);
  if (exactMatches.length === 1) return exactMatches[0];

  const scored = libraries
    .map((library) => ({
      library,
      score: scoreLibraryMatch(normalizedQuery, normalizeLookupText(library.name))
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.library.name.length - b.library.name.length);

  if (scored.length === 0) return undefined;
  const [best, second] = scored;
  if (!second || best.score > second.score) return best.library;
  return undefined;
}

function scoreLibraryMatch(normalizedQuery: string, normalizedName: string): number {
  if (!normalizedQuery || !normalizedName) return 0;
  if (normalizedName === normalizedQuery) return 1000;
  if (normalizedName.includes(normalizedQuery)) return 800 - Math.max(0, normalizedName.length - normalizedQuery.length);
  if (normalizedQuery.includes(normalizedName)) return 700 - Math.max(0, normalizedQuery.length - normalizedName.length);
  return 0;
}

function normalizeLookupText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[()（）\[\]{}·.,_-]/g, "");
}

type BookResolution =
  | { kind: "book"; book: BookSummary }
  | { kind: "message"; markdown: string };

async function resolveSingleBook(
  client: Data4LibraryClient,
  bookTitle: string | undefined,
  isbn: string | undefined
): Promise<BookResolution> {
  if (isbn) {
    return {
      kind: "book",
      book: {
        title: bookTitle ?? "",
        authors: "",
        publisher: "",
        publicationYear: "",
        isbn13: isbn,
        volume: "",
        imageUrl: ""
      }
    };
  }

  if (!bookTitle) {
    return {
      kind: "message",
      markdown: [
        "## 책을 찾을 수 없습니다",
        "",
        "책 제목을 입력해 주세요.",
        "",
        "- 예: `아몬드 읽고 다음 책 추천해줘`",
        "- ISBN을 알고 있다면 ISBN으로도 분석할 수 있습니다."
      ].join("\n")
    };
  }

  const books = await client.searchBooks(bookTitle);
  const isbnBooks = books.filter((book) => book.isbn13);
  if (isbnBooks.length === 0) {
    return {
      kind: "message",
      markdown: [
        "## 책을 찾을 수 없습니다",
        "",
        `\`${bookTitle}\`으로 검색된 책이 없거나 ISBN 정보를 찾지 못했습니다.`,
        "",
        "책 제목을 더 정확히 입력하거나 ISBN을 직접 입력해 주세요."
      ].join("\n")
    };
  }

  const selected = selectBestBookMatch(bookTitle, isbnBooks);
  if (selected) {
    return { kind: "book", book: selected };
  }

  if (isbnBooks.length > 1) {
    const rows = isbnBooks.slice(0, 10).map((book, index) => [
      String(index + 1),
      book.title || "-",
      book.authors || "-",
      book.publisher || "-",
      book.publicationYear || "-",
      book.isbn13
    ]);
    return {
      kind: "message",
      markdown: [
        "## 책 후보가 여러 개입니다",
        "",
        `\`${bookTitle}\`으로 여러 책이 검색되었습니다. 아래 후보 중 하나의 제목을 더 구체적으로 입력하거나 ISBN을 사용해 주세요.`,
        "",
        markdownTable(["번호", "제목", "저자", "출판사", "출판연도", "ISBN"], rows)
      ].join("\n")
    };
  }

  return { kind: "book", book: isbnBooks[0] };
}

function selectBestBookMatch(query: string, books: BookSummary[]): BookSummary | undefined {
  const normalizedQuery = normalizeLookupText(query);
  const exactWorkCandidates = books.filter((book) => normalizeBookBaseTitle(book.title) === normalizedQuery);
  const candidates = exactWorkCandidates.length > 0 ? exactWorkCandidates : books;

  if (candidates.length === 1) return candidates[0];

  const groups = new Map<string, BookSummary[]>();
  for (const book of candidates) {
    const key = `${normalizeBookBaseTitle(book.title)}:${normalizeAuthorKey(book.authors)}`;
    const group = groups.get(key) ?? [];
    group.push(book);
    groups.set(key, group);
  }

  const sortedGroups = [...groups.values()].sort((a, b) => b.length - a.length);
  const [largest, second] = sortedGroups;
  if (!largest) return undefined;

  const hasDominantWork = !second || largest.length > second.length;
  const queryMatchesLargestWork = normalizeBookBaseTitle(largest[0].title) === normalizedQuery;
  if (queryMatchesLargestWork && hasDominantWork) {
    return chooseRepresentativeBook(largest);
  }

  const exactTitleMatches = candidates.filter((book) => normalizeLookupText(book.title) === normalizedQuery);
  if (exactTitleMatches.length === 1) return exactTitleMatches[0];

  return undefined;
}

function chooseRepresentativeBook(books: BookSummary[]): BookSummary {
  const publisherFrequency = new Map<string, number>();
  for (const book of books) {
    const publisher = normalizeLookupText(book.publisher);
    if (!publisher) continue;
    publisherFrequency.set(publisher, (publisherFrequency.get(publisher) ?? 0) + 1);
  }

  return books
    .map((book, index) => ({ book, index, score: scoreRepresentativeBook(book, publisherFrequency) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)[0].book;
}

function scoreRepresentativeBook(book: BookSummary, publisherFrequency: Map<string, number>): number {
  const title = normalizeLookupText(book.title);
  const publisher = normalizeLookupText(book.publisher);
  const year = Number.parseInt(book.publicationYear, 10);
  let score = 0;

  score += (publisherFrequency.get(publisher) ?? 0) * 20;
  if (!/(큰글자|대활자|큰글씨|오디오북|전자책|ebook)/i.test(`${book.title} ${book.volume}`)) score += 80;
  if (book.loanCount !== undefined) score += Math.min(book.loanCount, 1000);
  if (Number.isFinite(year)) score += Math.max(0, 2100 - year);
  if (!title.includes("사용설명서") && !title.includes("초콜릿왈츠")) score += 10;

  return score;
}

function normalizeBookBaseTitle(title: string): string {
  const withoutSubtitle = title.split(/[:：]/)[0] ?? title;
  return normalizeLookupText(withoutSubtitle);
}

function normalizeAuthorKey(authors: string): string {
  return normalizeLookupText(authors)
    .replace(/지음|저자|글|옮김|번역|장편소설|소설/g, "")
    .slice(0, 30);
}

async function generateReadingRoadmap(
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

function rankQuietPoints(points: TrendPoint[]): Array<TrendPoint & { percentile: number }> {
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

function summarizeVisitMarkdown(markdown: string): string {
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

function buildOperatingHourVisitCandidates(operatingTime: string): VisitCandidate[] {
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

function formatBookTitle(book: BookSummary): string {
  const volume = book.volume ? ` ${book.volume}` : "";
  const year = book.publicationYear ? ` (${book.publicationYear})` : "";
  const isbn = book.isbn13 ? `, ISBN ${book.isbn13}` : "";
  return `${book.title || "제목 미상"}${volume}${year}${isbn}`;
}

function formatLibrary(library: LibrarySummary): string {
  const name = library.name || "도서관 이름 미상";
  const code = library.code ? ` (${library.code})` : "";
  const address = library.address ? ` - ${library.address}` : "";
  return `${name}${code}${address}`;
}

function inferRegionCodeFromAddress(address: string): string | undefined {
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

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  return String(value).trim() || undefined;
}

function formatToolError(error: unknown): string {
  if (error instanceof MissingAuthKeyError) {
    return [
      "데이터 조회를 위해 정보나루 인증키가 필요합니다.",
      "",
      "- 환경변수 `DATA4LIBRARY_AUTH_KEY`를 설정한 뒤 다시 시도해 주세요.",
      "- 서버와 도구 목록 조회는 인증키 없이도 동작하도록 구성되어 있습니다."
    ].join("\n");
  }

  const message = error instanceof Error ? error.message : String(error);
  return [
    "데이터를 불러오는 중 문제가 발생했습니다.",
    "",
    `- 원인: ${message}`,
    "- 실제 정보나루 응답을 기반으로만 답변해야 하므로, 실패 시 대체 데이터를 생성하지 않습니다."
  ].join("\n");
}
