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
  operatingTime: string;
  closedDays: string;
  latitude?: number;
  longitude?: number;
};

export type NearbyLibrary = LibrarySummary & {
  distanceKm: number;
};

export type PlaceSummary = {
  name: string;
  address: string;
  roadAddress: string;
  latitude: number;
  longitude: number;
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

export class MissingKakaoRestApiKeyError extends Error {
  constructor() {
    super("KAKAO_REST_API_KEY is not configured.");
  }
}

export class Data4LibraryClient {
  private readonly cache: TtlCache<unknown>;
  private readonly librarySearchCache: TtlCache<LibrarySummary[]>;
  private readonly parser = new XMLParser({
    ignoreAttributes: false,
    trimValues: true,
    parseTagValue: false,
    parseAttributeValue: false
  });

  constructor(private readonly config: AppConfig) {
    this.cache = new TtlCache(config.cacheTtlMs);
    this.librarySearchCache = new TtlCache(config.cacheTtlMs);
  }

  get cacheSize(): number {
    return this.cache.size;
  }

  hasAuthKey(): boolean {
    return Boolean(this.config.authKey);
  }

  hasKakaoRestApiKey(): boolean {
    return Boolean(this.config.kakaoRestApiKey);
  }

  async searchPlace(placeName: string): Promise<PlaceSummary[]> {
    if (!this.config.kakaoRestApiKey) throw new MissingKakaoRestApiKeyError();

    const query = placeName.trim();
    const json = await this.requestKakaoLocalJson("keyword", {
      query,
      size: "5"
    });
    const root = asObject(json) ?? {};
    return ensureArray(asObject(root)?.documents)
      .map(normalizePlace)
      .filter((place) => place.name && Number.isFinite(place.latitude) && Number.isFinite(place.longitude));
  }

  async searchLibraries(libraryName: string): Promise<LibrarySummary[]> {
    const query = libraryName.trim();
    const cached = this.librarySearchCache.get(query);
    if (cached) return cached;

    const firstPage = await this.getLibraryPage(1, query);
    const firstPageMatches = filterLibrariesByName(query, firstPage);
    if (hasExactLibraryMatch(query, firstPageMatches)) {
      this.librarySearchCache.set(query, firstPageMatches);
      return firstPageMatches;
    }

    const matches = new Map<string, LibrarySummary>();
    for (const library of firstPageMatches) {
      matches.set(library.code || library.name, library);
    }

    const pageSize = 100;
    const maxPages = 60;
    const seenPageSignatures = new Set<string>();
    for (let pageNo = 1; pageNo <= maxPages; pageNo += 1) {
      const page = pageNo === 1 ? await this.getLibraryPage(1, undefined, pageSize) : await this.getLibraryPage(pageNo, undefined, pageSize);
      if (page.length === 0) break;
      const pageSignature = page.map((library) => library.code || library.name).join("|");
      if (seenPageSignatures.has(pageSignature)) break;
      seenPageSignatures.add(pageSignature);

      for (const library of filterLibrariesByName(query, page)) {
        matches.set(library.code || library.name, library);
      }

      const currentMatches = [...matches.values()];
      if (hasExactLibraryMatch(query, currentMatches)) {
        this.librarySearchCache.set(query, currentMatches);
        return currentMatches;
      }
    }

    const result = [...matches.values()];
    this.librarySearchCache.set(query, result);
    return result;
  }

  async searchNearbyLibraries(
    latitude: number,
    longitude: number,
    radiusKm = 5,
    limit = 10
  ): Promise<NearbyLibrary[]> {
    const pageSize = 100;
    const maxPages = 80;
    const matches: NearbyLibrary[] = [];
    const seenPageSignatures = new Set<string>();

    for (let pageNo = 1; pageNo <= maxPages; pageNo += 1) {
      const page = await this.getLibraryPage(pageNo, undefined, pageSize);
      if (page.length === 0) break;

      const pageSignature = page.map((library) => library.code || library.name).join("|");
      if (seenPageSignatures.has(pageSignature)) break;
      seenPageSignatures.add(pageSignature);

      for (const library of page) {
        if (library.latitude === undefined || library.longitude === undefined) continue;
        const distanceKm = haversineKm(latitude, longitude, library.latitude, library.longitude);
        if (distanceKm <= radiusKm) {
          matches.push({ ...library, distanceKm });
        }
      }
    }

    return matches
      .sort((a, b) => a.distanceKm - b.distanceKm || a.name.localeCompare(b.name, "ko"))
      .slice(0, limit);
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
    const periods = buildPopularBookPeriods(today);

    let lastError: unknown;
    for (const period of periods) {
      try {
        const books = await this.getPopularBooksForPeriod(period.startDt, period.endDt, region, ageGroup);
        if (books.length > 0) return books;
      } catch (error) {
        lastError = error;
      }

      if (!region) continue;

      try {
        const nationalBooks = await this.getPopularBooksForPeriod(period.startDt, period.endDt, undefined, ageGroup);
        if (nationalBooks.length > 0) return nationalBooks;
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError instanceof Error) throw lastError;
    return [];
  }

  private async getPopularBooksForPeriod(
    startDt: string,
    endDt: string,
    region?: string,
    ageGroup?: string
  ): Promise<PopularBook[]> {
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

  private async getLibraryPage(pageNo: number, libraryName?: string, pageSize = 10): Promise<LibrarySummary[]> {
    const xml = await this.requestXml("libSrch", {
      libName: libraryName,
      pageNo: String(pageNo),
      pageSize: String(pageSize)
    });
    const response = this.responseOf(xml);
    return extractLibraries(response);
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
      const response = await fetch(url, { signal: controller.signal }).catch((error: unknown) => {
        if (isAbortError(error)) {
          throw new Error(`Data4Library request timed out after ${this.config.requestTimeoutMs}ms`);
        }
        throw error;
      });
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

  private async requestKakaoLocalJson(
    searchType: "keyword",
    params: Record<string, string | undefined>
  ): Promise<unknown> {
    if (!this.config.kakaoRestApiKey) throw new MissingKakaoRestApiKeyError();

    const url = new URL(`https://dapi.kakao.com/v2/local/search/${searchType}.json`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") url.searchParams.set(key, value);
    }

    const cacheKeyParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") cacheKeyParams.set(key, value);
    }
    const cacheKey = `kakao:${searchType}?${cacheKeyParams.toString()}`;
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) return cached;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Authorization: `KakaoAK ${this.config.kakaoRestApiKey}`
        }
      }).catch((error: unknown) => {
        if (isAbortError(error)) {
          throw new Error(`Kakao Local request timed out after ${this.config.requestTimeoutMs}ms`);
        }
        throw error;
      });
      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        throw new Error(
          `Kakao Local returned HTTP ${response.status}${errorBody ? `: ${truncateErrorBody(errorBody)}` : ""}`
        );
      }
      const parsed = await response.json() as unknown;
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

function normalizePlace(value: unknown): PlaceSummary {
  const item = asObject(value) ?? {};
  const latitude = validCoordinate(numberFrom(item.y), -90, 90);
  const longitude = validCoordinate(numberFrom(item.x), -180, 180);
  return {
    name: cleanText(item.place_name ?? item.name),
    address: cleanText(item.address_name ?? item.address),
    roadAddress: cleanText(item.road_address_name ?? item.roadAddress),
    latitude: latitude ?? Number.NaN,
    longitude: longitude ?? Number.NaN
  };
}

function normalizeLibrary(value: unknown): LibrarySummary {
  const item = asObject(value) ?? {};
  const latitude = normalizeLatitude(item);
  const longitude = normalizeLongitude(item);
  return {
    code: cleanText(item.libCode ?? item.libraryCode ?? item.code),
    name: cleanText(item.libName ?? item.libraryName ?? item.name),
    address: cleanText(item.address ?? item.addr ?? item.libAddress),
    tel: cleanText(item.tel ?? item.phone ?? item.libTel),
    homepage: cleanText(item.homepage ?? item.homepageUrl ?? item.url),
    operatingTime: firstAvailableText(item, [
      "operatingTime",
      "operatingHours",
      "openTime",
      "libTime",
      "libOperatingTime",
      "serviceTime",
      "weekdayTime",
      "weekendTime"
    ]),
    closedDays: firstAvailableText(item, [
      "closed",
      "closedDays",
      "closedDay",
      "closeDay",
      "holiday",
      "restDay",
      "regularClosed"
    ]),
    ...(latitude !== undefined ? { latitude } : {}),
    ...(longitude !== undefined ? { longitude } : {})
  };
}

function normalizeLatitude(item: XmlObject): number | undefined {
  return validCoordinate(
    numberFrom(item.latitude ?? item.lat ?? item.libLatitude ?? item.y ?? item.mapY ?? item.geoY),
    -90,
    90
  );
}

function normalizeLongitude(item: XmlObject): number | undefined {
  return validCoordinate(
    numberFrom(item.longitude ?? item.lng ?? item.lon ?? item.libLongitude ?? item.x ?? item.mapX ?? item.geoX),
    -180,
    180
  );
}

function validCoordinate(value: number | undefined, min: number, max: number): number | undefined {
  return value !== undefined && value >= min && value <= max ? value : undefined;
}

function extractLibraries(response: unknown): LibrarySummary[] {
  const root = asObject(response) ?? {};
  const libs = asObject(root.libs);
  const rawLibraries = ensureArray(libs?.lib ?? root.lib);
  return rawLibraries
    .map(normalizeLibrary)
    .filter((library) => library.code || library.name);
}

function filterLibrariesByName(query: string, libraries: LibrarySummary[]): LibrarySummary[] {
  const normalizedQuery = normalizeLookupText(query);
  if (!normalizedQuery) return [];
  return libraries.filter((library) => {
    const normalizedName = normalizeLookupText(library.name);
    return normalizedName === normalizedQuery ||
      normalizedName.includes(normalizedQuery) ||
      normalizedQuery.includes(normalizedName);
  });
}

function hasExactLibraryMatch(query: string, libraries: LibrarySummary[]): boolean {
  const normalizedQuery = normalizeLookupText(query);
  return libraries.some((library) => normalizeLookupText(library.name) === normalizedQuery);
}

function normalizeLookupText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[()（）\[\]{}·.,_-]/g, "");
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

function firstAvailableText(item: XmlObject, keys: string[]): string {
  const direct = firstText(item, keys);
  if (direct) return direct;

  const joined = keys
    .flatMap((key) => flattenText(item[key]))
    .filter(Boolean)
    .join(" / ");
  return cleanText(joined);
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

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function truncateErrorBody(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 500);
}

function haversineKm(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number
): number {
  const earthRadiusKm = 6371;
  const dLat = toRadians(latitudeB - latitudeA);
  const dLon = toRadians(longitudeB - longitudeA);
  const latA = toRadians(latitudeA);
  const latB = toRadians(latitudeB);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(latA) * Math.cos(latB) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

function toRadians(degrees: number): number {
  return degrees * Math.PI / 180;
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildPopularBookPeriods(today: Date): Array<{ startDt: string; endDt: string }> {
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const recentStart = new Date(yesterday);
  recentStart.setDate(recentStart.getDate() - 30);

  const previousYear = today.getFullYear() - 1;
  const twoYearsAgo = today.getFullYear() - 2;

  return [
    {
      startDt: formatDate(recentStart),
      endDt: formatDate(yesterday)
    },
    {
      startDt: `${previousYear}-01-01`,
      endDt: `${previousYear}-12-31`
    },
    {
      startDt: `${twoYearsAgo}-01-01`,
      endDt: `${twoYearsAgo}-12-31`
    }
  ];
}
