import { Data4LibraryClient, MissingAuthKeyError, BookSummary, TrendPoint } from "./data4library.js";
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
      "Calculates quieter visiting times from Data4Library(도서관 정보나루) usageTrend data for LibraryQuietSpot(도서관혼잡도). Returns markdown, not raw API JSON.",
    inputSchema: {
      type: "object",
      properties: {
        library_code: {
          type: "string",
          description: "Library code from Data4Library."
        }
      },
      required: ["library_code"],
      additionalProperties: false
    },
    annotations: {
      title: "Find quieter library visit times",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
      idempotentHint: true
    }
  },
  {
    name: "find_trending_books_and_library_match",
    description:
      "Finds popular books from Data4Library(도서관 정보나루), checks whether a selected library owns them, and combines the result with LibraryQuietSpot(도서관혼잡도) visit-time guidance.",
    inputSchema: {
      type: "object",
      properties: {
        region: {
          type: "string",
          description: "Region code used by Data4Library popular-loan search."
        },
        age_group: {
          type: "string",
          description: "Optional age group code used by Data4Library popular-loan search."
        },
        library_code: {
          type: "string",
          description: "Library code used for ownership checks."
        }
      },
      required: ["region", "library_code"],
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
      "Builds a measured reading roadmap from Data4Library(도서관 정보나루) usageAnalysisList co-loan, mania, and reader recommendation data for LibraryQuietSpot(도서관혼잡도).",
    inputSchema: {
      type: "object",
      properties: {
        isbn: {
          type: "string",
          description: "ISBN-13 of the book to analyze."
        }
      },
      required: ["isbn"],
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
        return guardMarkdown(await findBestVisitTime(client, requireString(args, "library_code")));
      case "find_trending_books_and_library_match":
        return guardMarkdown(
          await findTrendingBooksAndLibraryMatch(
            client,
            requireString(args, "region"),
            optionalString(args, "age_group"),
            requireString(args, "library_code")
          )
        );
      case "generate_data_driven_reading_roadmap":
        return guardMarkdown(await generateReadingRoadmap(client, requireString(args, "isbn")));
      default:
        return `알 수 없는 도구입니다: \`${name}\``;
    }
  } catch (error) {
    return formatToolError(error);
  }
}

async function findBestVisitTime(client: Data4LibraryClient, libraryCode: string): Promise<string> {
  const [dayPoints, hourPoints] = await Promise.all([
    client.getUsageTrend(libraryCode, "D"),
    client.getUsageTrend(libraryCode, "H")
  ]);

  const allPoints = [...dayPoints, ...hourPoints];
  if (allPoints.length === 0) {
    return [
      "## 한산한 방문 시간",
      "",
      "이 도서관은 혼잡도 데이터가 제공되지 않습니다.",
      "",
      `- 도서관 코드: \`${libraryCode}\``,
      "- 정보나루 참여 도서관 또는 usageTrend 제공 범위에 포함되지 않았을 수 있습니다.",
      "- 데이터가 없는 경우 임의로 혼잡도를 추측하지 않습니다."
    ].join("\n");
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
  region: string,
  ageGroup: string | undefined,
  libraryCode: string
): Promise<string> {
  const [popularBooks, visitMarkdown] = await Promise.all([
    client.getPopularBooks(region, ageGroup),
    findBestVisitTime(client, libraryCode)
  ]);

  if (popularBooks.length === 0) {
    return [
      "## 인기 도서 소장 매칭",
      "",
      "조건에 맞는 인기 도서 데이터를 찾지 못했습니다.",
      "",
      `- 지역 코드: \`${region}\``,
      ageGroup ? `- 연령 코드: \`${ageGroup}\`` : "- 연령 코드: 전체",
      `- 도서관 코드: \`${libraryCode}\``
    ].join("\n");
  }

  const checks = await Promise.all(
    popularBooks.slice(0, 5).map(async (book) => ({
      book,
      exist: book.isbn13 ? await client.getBookExist(libraryCode, book.isbn13) : undefined
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

  const visitSummary = visitMarkdown.split("\n").slice(0, 8).join("\n");

  return [
    "## 인기 도서 소장 매칭",
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

async function generateReadingRoadmap(client: Data4LibraryClient, isbn: string): Promise<string> {
  const analysis = await client.getUsageAnalysis(isbn);
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
      `- ISBN: \`${isbn}\``,
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
    : ["## 기준 도서", "", `- ISBN: \`${isbn}\``].join("\n");

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

function requireString(args: Record<string, unknown>, key: string): string {
  const value = optionalString(args, key);
  if (!value) throw new Error(`필수 입력값 \`${key}\`가 필요합니다.`);
  return value;
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
