import { XMLParser } from "fast-xml-parser";
import { TtlCache } from "./cache.js";
import { AppConfig } from "./config.js";
import { cleanText, ensureArray, numberFrom } from "./text.js";

export type BookSummary = {
  title: string;
  authors: string;
  publisher: string;
  publicationYear: string;
  isbn13: string;
  volume: string;
  imageUrl: string;
  loanCount?: number;
};

export type LoanHistoryItem = {
  month: string;
  loanCount?: number;
  ranking?: number;
};

export type LoanGroupItem = {
  age: string;
  gender: string;
  loanCount?: number;
  ranking?: number;
};

export type KeywordItem = {
  word: string;
  weight: string;
};

export type UsageAnalysis = {
  book?: BookSummary;
  loanHistory: LoanHistoryItem[];
  loanGroups: LoanGroupItem[];
  keywords: KeywordItem[];
  coLoanBooks: BookSummary[];
  maniaRecBooks: BookSummary[];
  readerRecBooks: BookSummary[];
};

export type BookExistResult = {
  hasBook?: boolean;
  loanAvailable?: boolean;
  rawStatus: string;
};

export type LibrarySummary = {
  code: string;
  name: string;
  address: string;
  tel: string;
  homepage: string;
};

export type TrendPoint = {
  label: string;
  count: number;
  bucket: "day" | "hour" | "unknown";
};

export type PopularBook = BookSummary & {
  ranking?: number;
};

type XmlObject = Record<string, unknown>;

export class MissingAuthKeyError extends Error {
  constructor() {
    super("DATA4LIBRARY_AUTH_KEY is not configured.");
  }
}

export class Data4LibraryClient {
  private readonly cache: TtlCache<unknown>;
  private readonly parser = new XMLParser({
    ignoreAttributes: false,
    trimValues: true,
    parseTagValue: false,
    parseAttributeValue: false
  });

  constructor(private readonly config: AppConfig) {
    this.cache = new TtlCache(config.cacheTtlMs);
  }

  get cacheSize(): number {
    return this.cache.size;
  }

  hasAuthKey(): boolean {
    return Boolean(this.config.authKey);
  }

  async searchLibraries(libraryName: string): Promise<LibrarySummary[]> {
    const xml = await this.requestXml("libSrch", {
      libName: libraryName,
      pageNo: "1",
      pageSize: "10"
    });
    const response = this.responseOf(xml);
    const libs = asObject(response)?.libs;
    const rawLibraries = ensureArray(asObject(libs)?.lib ?? asObject(response)?.lib);

    return rawLibraries
      .map(normalizeLibrary)
      .filter((library) => library.code || library.name);
  }

  async getUsageTrend(libraryCode: string, type: "D" | "H"): Promise<TrendPoint[]> {
    const xml = await this.requestXml("usageTrend", {
      libCode: libraryCode,
      type
    });
    const response = this.responseOf(xml);
    return extractTrendPoints(response, type === "D" ? "day" : "hour");
  }

  async getBookExist(libraryCode: string, isbn13: string): Promise<BookExistResult> {
    const xml = await this.requestXml("bookExist", {
      libCode: libraryCode,
      isbn13
    });
    const response = this.responseOf(xml);
    const result = findFirstObject(response, ["result", "bookExist", "book"]);
    const rawText = flattenText(result ?? response).join(" ");
    const hasBook = parseBooleanLike(
      firstText(result, ["hasBook", "exist", "bookExist", "result", "isbn13"]) || rawText
    );
    const loanAvailable = parseBooleanLike(
      firstText(result, ["loanAvailable", "loanable", "available", "loanYn", "loanStatus"])
    );

    return {
      hasBook,
      loanAvailable,
      rawStatus: rawText || "응답 상태 필드를 확인할 수 없습니다."
    };
  }

  async getUsageAnalysis(isbn13: string): Promise<UsageAnalysis> {
    const xml = await this.requestXml("usageAnalysisList", { isbn13 });
    const response = this.responseOf(xml);

    return {
      book: normalizeBook((response as XmlObject).book),
      loanHistory: ensureArray(asObject((response as XmlObject).loanHistory)?.loan).map(normalizeLoanHistory),
      loanGroups: ensureArray(asObject((response as XmlObject).loanGrps)?.loanGrp).map(normalizeLoanGroup),
      keywords: ensureArray(asObject((response as XmlObject).keywords)?.keyword).map(normalizeKeyword),
      coLoanBooks: normalizeBookList((response as XmlObject).coLoanBooks),
      maniaRecBooks: normalizeBookList((response as XmlObject).maniaRecBooks),
      readerRecBooks: normalizeBookList((response as XmlObject).readerRecBooks)
    };
  }

  async getPopularBooks(region?: string, ageGroup?: string): Promise<PopularBook[]> {
    const today = new Date();
    const endDt = formatDate(today);
    const start = new Date(today);
    start.setDate(start.getDate() - 30);
    const startDt = formatDate(start);

    const xml = await this.requestXml("loanItemSrch", {
      startDt,
      endDt,
      region,
      age: ageGroup,
      pageNo: "1",
      pageSize: "5"
    });
    const response = this.responseOf(xml);
    const docs = asObject(response)?.docs;
    const rawBooks = ensureArray(asObject(docs)?.doc ?? asObject(response)?.doc);

    return rawBooks.map((item, index) => ({
      ...normalizeBook(item),
      ranking: numberFrom(asObject(item)?.ranking) ?? index + 1
    })).filter((book) => book.title || book.isbn13);
  }

  async searchBooks(title: string): Promise<BookSummary[]> {
    const xml = await this.requestXml("srchBooks", {
      title,
      pageNo: "1",
      pageSize: "10"
    });
    const response = this.responseOf(xml);
    const docs = asObject(response)?.docs;
    const rawBooks = ensureArray(asObject(docs)?.doc ?? asObject(response)?.doc);

    return rawBooks
      .map(normalizeBook)
      .filter((book) => book.title || book.isbn13);
  }

  private async requestXml(endpoint: string, params: Record<string, string | undefined>): Promise<unknown> {
    if (!this.config.authKey) throw new MissingAuthKeyError();

    const url = new URL(`https://data4library.kr/api/${endpoint}`);
    url.searchParams.set("authKey", this.config.authKey);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") url.searchParams.set(key, value);
    }

    const cacheKeyParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") cacheKeyParams.set(key, value);
    }
    const cacheKey = `${endpoint}?${cacheKeyParams.toString()}`;
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) return cached;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`Data4Library returned HTTP ${response.status}`);
      }
      const text = await response.text();
      const parsed = this.parser.parse(text) as unknown;
      this.cache.set(cacheKey, parsed);
      return parsed;
    } finally {
      clearTimeout(timeout);
    }
  }

  private responseOf(xml: unknown): unknown {
    const root = asObject(xml);
    return root?.response ?? xml;
  }
}

function normalizeBookList(value: unknown): BookSummary[] {
  return ensureArray(asObject(value)?.book).map(normalizeBook).filter((book) => book.title || book.isbn13);
}

function normalizeBook(value: unknown): BookSummary {
  const item = asObject(value) ?? {};
  return {
    title: cleanText(item.bookname ?? item.bookName ?? item.title),
    authors: cleanText(item.authors ?? item.author),
    publisher: cleanText(item.publisher),
    publicationYear: cleanText(item.publication_year ?? item.publicationYear ?? item.pubYear),
    isbn13: cleanText(item.isbn13 ?? item.isbn),
    volume: cleanText(item.vol ?? item.volume),
    imageUrl: cleanText(item.bookImageURL ?? item.bookImageUrl ?? item.imageUrl),
    loanCount: numberFrom(item.loanCnt ?? item.loanCount)
  };
}

function normalizeLibrary(value: unknown): LibrarySummary {
  const item = asObject(value) ?? {};
  return {
    code: cleanText(item.libCode ?? item.libraryCode ?? item.code),
    name: cleanText(item.libName ?? item.libraryName ?? item.name),
    address: cleanText(item.address ?? item.addr ?? item.libAddress),
    tel: cleanText(item.tel ?? item.phone ?? item.libTel),
    homepage: cleanText(item.homepage ?? item.homepageUrl ?? item.url)
  };
}

function normalizeLoanHistory(value: unknown): LoanHistoryItem {
  const item = asObject(value) ?? {};
  return {
    month: cleanText(item.month),
    loanCount: numberFrom(item.loanCnt),
    ranking: numberFrom(item.ranking)
  };
}

function normalizeLoanGroup(value: unknown): LoanGroupItem {
  const item = asObject(value) ?? {};
  const age = cleanText(item.age);
  return {
    age: age || "연령 미상",
    gender: cleanText(item.gender) || "성별 미상",
    loanCount: numberFrom(item.loanCnt),
    ranking: numberFrom(item.ranking)
  };
}

function normalizeKeyword(value: unknown): KeywordItem {
  const item = asObject(value) ?? {};
  return {
    word: cleanText(item.word),
    weight: cleanText(item.weight)
  };
}

function extractTrendPoints(response: unknown, bucket: TrendPoint["bucket"]): TrendPoint[] {
  const points: TrendPoint[] = [];
  walk(response, (key, value) => {
    const item = asObject(value);
    if (!item) return;

    const count = numberFrom(
      item.loanCnt ?? item.loanCount ?? item.returnCnt ?? item.returnCount ?? item.count ?? item.cnt
    );
    if (count === undefined) return;

    const label = cleanText(
      item.day ?? item.week ?? item.weekday ?? item.hour ?? item.time ?? item.timeSlot ?? item.month ?? key
    );
    if (label) points.push({ label, count, bucket });
  });

  return dedupeTrendPoints(points);
}

function dedupeTrendPoints(points: TrendPoint[]): TrendPoint[] {
  const seen = new Set<string>();
  const result: TrendPoint[] = [];
  for (const point of points) {
    const key = `${point.bucket}:${point.label}:${point.count}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(point);
  }
  return result;
}

function firstText(value: unknown, keys: string[]): string {
  const item = asObject(value);
  if (!item) return "";
  for (const key of keys) {
    const text = cleanText(item[key]);
    if (text) return text;
  }
  return "";
}

function findFirstObject(value: unknown, keys: string[]): unknown {
  const root = asObject(value);
  if (!root) return undefined;
  for (const key of keys) {
    if (root[key] !== undefined) return root[key];
  }
  for (const child of Object.values(root)) {
    const found = findFirstObject(child, keys);
    if (found !== undefined) return found;
  }
  return undefined;
}

function flattenText(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (typeof value !== "object") {
    const text = cleanText(value);
    return text ? [text] : [];
  }
  return Object.values(value as XmlObject).flatMap(flattenText);
}

function parseBooleanLike(value: string): boolean | undefined {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (["y", "yes", "true", "1"].includes(normalized)) return true;
  if (["n", "no", "false", "0"].includes(normalized)) return false;
  if (["가능", "소장", "있음", "대출가능"].some((token) => normalized.includes(token))) {
    return true;
  }
  if (["불가", "없음", "미소장"].some((token) => normalized.includes(token))) {
    return false;
  }
  return undefined;
}

function walk(value: unknown, visit: (key: string, value: unknown) => void, key = ""): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) => walk(child, visit, String(index)));
    return;
  }
  if (!value || typeof value !== "object") return;
  visit(key, value);
  for (const [childKey, child] of Object.entries(value as XmlObject)) {
    walk(child, visit, childKey);
  }
}

function asObject(value: unknown): XmlObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as XmlObject : undefined;
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
