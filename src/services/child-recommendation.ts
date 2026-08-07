import { AladinBook, BookExistResult, BookSummary, Data4LibraryClient, LibrarySummary, PlaceSummary, PopularBook } from "../data4library.js";
import { markdownTable } from "../text.js";
import { clampNumber, collectCompanionBooks, formatBookTitle, formatExistStatus, formatLibrary, formatLoanStatus, formatPlace, inferRegionCodeFromAddress, isValidLatitude, isValidLongitude, renderBestVisitTime, summarizeVisitMarkdown } from "./library-visit.js";
import { normalizeAuthorKey, normalizeBookBaseTitle, normalizeLookupText, resolveSingleLibrary } from "./resolvers.js";

export async function recommendBooksForChild(
  client: Data4LibraryClient,
  age: number | undefined,
  grade: string | undefined,
  interests: string[],
  preferNonComic: boolean | undefined,
  excludeKeywords: string[],
  libraryName: string | undefined,
  libraryCode: string | undefined,
  placeName: string | undefined,
  latitude: number | undefined,
  longitude: number | undefined,
  region: string | undefined,
  limit: number | undefined
): Promise<string> {
  const profile = resolveChildReadingProfile(age, grade);
  if (!profile) {
    return [
      "## 자녀 맞춤 추천을 만들 수 없습니다",
      "",
      "자녀의 나이 또는 학년을 입력해 주세요.",
      "",
      "- 예: `초등학교 3학년 아이가 과학 좋아하는데 책 추천해줘`",
      "- 예: `7살 아이랑 부산 서면역 근처 도서관 갈 건데 그림책 추천해줘`"
    ].join("\n");
  }

  const safeLimit = Math.round(clampNumber(limit ?? 3, 1, 5));
  const libraryTarget = await resolveLibraryTargets(client, libraryName, libraryCode, placeName, latitude, longitude);
  if (libraryTarget.kind === "message") return libraryTarget.markdown;

  const effectiveRegion = region
    ?? libraryTarget.libraries.map((library) => inferRegionCodeFromAddress(library.address)).find(Boolean);
  const popularSource = await getChildPopularBooks(client, effectiveRegion, profile.ageGroupCode, interests);
  const popularBooks = popularSource.books;
  const exclusionRules = buildRecommendationExclusionRules(excludeKeywords, preferNonComic);
  if (popularBooks.length === 0) {
    return [
      "## 자녀 맞춤 추천 후보를 찾지 못했습니다",
      "",
      `- 독자 기준: ${profile.label}`,
      effectiveRegion ? `- 지역 코드: \`${effectiveRegion}\`` : "- 지역 코드: 전국",
      "",
      "정보나루 연령대별 인기 대출 데이터에 조건과 맞는 응답이 없습니다. 관심사를 줄이거나 지역 조건 없이 다시 시도해 주세요."
    ].join("\n");
  }

  const baseCandidates = popularBooks.slice(0, 50).map((book, index) => {
      const interestScore = scoreInterestMatch(book, interests);
      const comicLike = isComicLikeBook(book);
      const excluded = matchesRecommendationExclusion(book, exclusionRules);
      const comicPenalty = comicLike ? (preferNonComic ? 600 : 240) : 0;
      return {
        book,
        ranking: book.ranking ?? index + 1,
        interestScore,
        comicLike,
        excluded,
        score: 1000 - ((book.ranking ?? index + 1) * 14) + interestScore - comicPenalty
      };
  });

  const filtered = baseCandidates.filter((candidate) => !candidate.excluded);
  const sortedCandidates = (filtered.length > 0 ? filtered : baseCandidates)
    .sort((a, b) => b.score - a.score || a.ranking - b.ranking)
  const selectedRecommendations = selectChildRecommendations(sortedCandidates, safeLimit, preferNonComic === true);
  const recommendations = await enrichChildRecommendationsWithAladin(client, selectedRecommendations);

  const holdingRows = await buildChildRecommendationRows(client, recommendations, libraryTarget.libraries, profile, interests);
  const topBook = recommendations[0]?.book;
  const nextBooks = topBook?.isbn13
    ? collectCompanionBooks(await client.getUsageAnalysis(topBook.isbn13).catch(() => undefined)).slice(0, 3)
    : [];
  const visitMarkdown = libraryTarget.libraries[0]
    ? await renderBestVisitTime(client, libraryTarget.libraries[0]).catch(() => "")
    : "";

  return [
    "## 자녀 맞춤 도서 추천",
    "",
    `독자 기준: ${profile.label}`,
    interests.length > 0 ? `관심사: ${interests.join(", ")}` : "관심사: 지정 없음",
    preferNonComic ? "추천 조건: 만화/학습만화 제외 우선" : "",
    excludeKeywords.length > 0 ? `제외 키워드: ${excludeKeywords.join(", ")}` : "",
    effectiveRegion ? `정보나루 지역 코드: \`${effectiveRegion}\`` : "정보나루 지역 코드: 전국",
    popularSource.kdcCodes.length > 0 ? `정보나루 주제분류: ${popularSource.kdcCodes.map(formatKdcCode).join(", ")}` : "",
    libraryTarget.summary,
    "",
    "정보나루 연령대별 인기 대출 데이터를 기본 후보로 사용하고, 추천 도서는 지정 도서관 또는 주변 도서관의 소장·대출 정보와 함께 보여줍니다.",
    "",
    markdownTable(["순위", "추천 도서", "추천 근거", "도서관 소장/대출"], holdingRows),
    "",
    "## 같이 빌리기 좋은 다음 책",
    "",
    nextBooks.length > 0
      ? nextBooks.map((item) => `- ${formatBookTitle(item.book)} - ${item.source} 데이터 기반`).join("\n")
      : "- 기준 도서의 정보나루 이용분석 응답에 함께 추천할 책이 없습니다.",
    "",
    libraryTarget.libraries.length > 0 ? "## 방문 후보" : "",
    libraryTarget.libraries.length > 0 ? summarizeVisitMarkdown(visitMarkdown) : "",
    "",
    "이 추천은 자녀의 독서 수준을 확정 판단하지 않고, 실제 대출 데이터와 서점 메타데이터를 바탕으로 고를 만한 후보를 좁혀 줍니다."
  ].filter((line) => line !== "").join("\n");
}

type ChildReadingProfile = {
  label: string;
  ageGroupCode: string;
};

type LibraryTargetResolution =
  | { kind: "libraries"; libraries: LibrarySummary[]; summary: string }
  | { kind: "message"; markdown: string };

type ChildRecommendationCandidate = {
  book: BookSummary;
  ranking: number;
  aladin?: AladinBook;
  interestScore: number;
  comicLike: boolean;
  excluded: boolean;
  score: number;
};

type RecommendationExclusionRules = {
  keywords: string[];
  excludeComics: boolean;
};

type ChildPopularBookSource = {
  books: PopularBook[];
  kdcCodes: string[];
};

type KdcGroup = {
  code: string;
  label: string;
  keywords: string[];
};

const KDC_GROUPS: KdcGroup[] = [
  {
    code: "0",
    label: "총류",
    keywords: ["총류", "백과", "사전", "신문", "저널", "독서", "도서관", "정보", "컴퓨터", "코딩", "프로그래밍", "인공지능", "ai"]
  },
  {
    code: "1",
    label: "철학",
    keywords: ["철학", "심리", "생각", "마음", "논리", "윤리", "인성", "감정", "습관"]
  },
  {
    code: "2",
    label: "종교",
    keywords: ["종교", "신화", "불교", "기독교", "천주교", "이슬람", "명상"]
  },
  {
    code: "3",
    label: "사회과학",
    keywords: ["사회", "경제", "문화", "정치", "법", "교육", "직업", "환경", "인권", "미디어", "경제"]
  },
  {
    code: "4",
    label: "자연과학",
    keywords: ["과학", "수학", "물리", "화학", "생물", "지구", "우주", "천문", "자연", "공룡", "동물", "식물", "실험"]
  },
  {
    code: "5",
    label: "기술과학",
    keywords: ["기술", "공학", "의학", "건강", "농업", "요리", "발명", "로봇", "기계", "생활과학"]
  },
  {
    code: "6",
    label: "예술",
    keywords: ["예술", "미술", "그림", "음악", "디자인", "만들기", "공예", "사진", "스포츠", "체육", "만화", "웹툰"]
  },
  {
    code: "7",
    label: "언어",
    keywords: ["언어", "국어", "영어", "한글", "말하기", "글쓰기", "어휘", "문법", "외국어"]
  },
  {
    code: "8",
    label: "문학",
    keywords: ["문학", "동화", "소설", "시", "이야기", "명작", "창작", "그림책", "판타지", "모험"]
  },
  {
    code: "9",
    label: "역사",
    keywords: ["역사", "한국사", "세계사", "조선", "고려", "인물", "위인", "전기", "지리", "여행", "문화유산"]
  }
];

export function resolveChildReadingProfile(age: number | undefined, grade: string | undefined): ChildReadingProfile | undefined {
  const gradeText = grade ? normalizeLookupText(grade) : "";
  const schoolProfile = parseSchoolProfile(gradeText, grade);
  if (schoolProfile) return schoolProfile;

  const parsedAge = age ?? parseAgeFromText(gradeText);
  if (parsedAge === undefined) return undefined;
  const roundedAge = Math.round(parsedAge);
  if (roundedAge <= 7) return { label: `${roundedAge}살`, ageGroupCode: "6" };
  if (roundedAge <= 13) return { label: `${roundedAge}살`, ageGroupCode: "8" };
  if (roundedAge <= 19) return { label: `${roundedAge}살`, ageGroupCode: "14" };
  if (roundedAge < 30) return { label: `${roundedAge}살`, ageGroupCode: "20" };
  return { label: `${roundedAge}살`, ageGroupCode: String(Math.floor(roundedAge / 10) * 10) };
}

function parseSchoolProfile(text: string, original: string | undefined): ChildReadingProfile | undefined {
  if (!text) return undefined;
  const label = original?.trim() || "";

  if (/예비초등|예비초|취학전|미취학|유아|유치|유치원|어린이집|영유아/.test(text)) {
    return { label: label || "미취학 아동", ageGroupCode: "6" };
  }

  if (/초등저학년|초저|초등낮은학년|초등1학년|초등학교1학년|초1|초등2학년|초등학교2학년|초2|초등3학년|초등학교3학년|초3/.test(text)) {
    return { label: label || "초등 저학년", ageGroupCode: "8" };
  }

  if (/초등고학년|초고|초등높은학년|초등4학년|초등학교4학년|초4|초등5학년|초등학교5학년|초5|초등6학년|초등학교6학년|초6/.test(text)) {
    return { label: label || "초등 고학년", ageGroupCode: "8" };
  }

  if (/초등|초등학생|초등학교|초등생/.test(text)) {
    return { label: label || "초등학생", ageGroupCode: "8" };
  }

  if (/중등|중학생|중학교|중등1학년|중학교1학년|중1|중등2학년|중학교2학년|중2|중등3학년|중학교3학년|중3/.test(text)) {
    return { label: label || "중학생", ageGroupCode: "14" };
  }

  if (/고등|고등학생|고등학교|고등1학년|고등학교1학년|고1|고등2학년|고등학교2학년|고2|고등3학년|고등학교3학년|고3|청소년/.test(text)) {
    return { label: label || "청소년", ageGroupCode: "14" };
  }

  if (/대학생|성인|20대|스무살/.test(text)) {
    return { label: label || "20대", ageGroupCode: "20" };
  }

  return undefined;
}

function parseAgeFromText(text: string): number | undefined {
  if (!text) return undefined;
  const match = text.match(/(?:만)?(\d{1,2})(?:살|세|개월|세반|살반)/);
  if (!match) return undefined;
  const value = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

async function resolveLibraryTargets(
  client: Data4LibraryClient,
  libraryName: string | undefined,
  libraryCode: string | undefined,
  placeName: string | undefined,
  latitude: number | undefined,
  longitude: number | undefined
): Promise<LibraryTargetResolution> {
  if (libraryName || libraryCode) {
    const resolved = await resolveSingleLibrary(client, libraryName, libraryCode);
    if (resolved.kind === "message") return { kind: "message", markdown: resolved.markdown };
    return {
      kind: "libraries",
      libraries: [resolved.library],
      summary: `도서관: ${formatLibrary(resolved.library)}`
    };
  }

  let resolvedPlace: PlaceSummary | undefined;
  let resolvedLatitude = latitude;
  let resolvedLongitude = longitude;
  if (placeName && (resolvedLatitude === undefined || resolvedLongitude === undefined)) {
    const places = await client.searchPlace(placeName);
    resolvedPlace = places[0];
    if (!resolvedPlace) {
      return {
        kind: "message",
        markdown: [
          "## 장소를 찾을 수 없습니다",
          "",
          `\`${placeName}\`으로 검색된 장소가 없습니다.`,
          "",
          "장소명을 더 구체적으로 입력하거나 도서관 이름을 직접 입력해 주세요."
        ].join("\n")
      };
    }
    resolvedLatitude = resolvedPlace.latitude;
    resolvedLongitude = resolvedPlace.longitude;
  }

  if (resolvedLatitude === undefined || resolvedLongitude === undefined) {
    return {
      kind: "libraries",
      libraries: [],
      summary: "도서관: 지정 없음\n도서관 소장·방문 정보까지 보려면 `place_name` 또는 `library_name`을 함께 입력해 주세요."
    };
  }

  if (!isValidLatitude(resolvedLatitude) || !isValidLongitude(resolvedLongitude)) {
    return {
      kind: "message",
      markdown: [
        "## 위치 좌표가 올바르지 않습니다",
        "",
        `- latitude: ${resolvedLatitude}`,
        `- longitude: ${resolvedLongitude}`,
        "- 위도는 -90~90, 경도는 -180~180 범위여야 합니다."
      ].join("\n")
    };
  }

  const libraries = await client.searchNearbyLibraries(resolvedLatitude, resolvedLongitude, 5, 3);
  const basis = resolvedPlace ? `기준 장소: ${formatPlace(resolvedPlace)}` : `기준 좌표: ${resolvedLatitude}, ${resolvedLongitude}`;
  return {
    kind: "libraries",
    libraries,
    summary: libraries.length > 0
      ? `${basis}\n근처 도서관: ${libraries.map((library) => `${library.name}(${library.distanceKm.toFixed(2)}km)`).join(", ")}`
      : `${basis}\n근처 도서관: 검색 반경 5km 안에서 찾지 못함`
  };
}

async function findAladinMatch(client: Data4LibraryClient, book: BookSummary): Promise<AladinBook | undefined> {
  if (book.isbn13) {
    const exactIsbnBook = await client.getAladinBookByIsbn(book.isbn13);
    if (exactIsbnBook) return exactIsbnBook;
  }

  const query = book.title;
  if (!query) return undefined;
  const aladinBooks = await client.searchAladinBooks(query, 5);
  if (aladinBooks.length === 0) return undefined;

  const normalizedTitle = normalizeBookBaseTitle(book.title);
  const exactIsbn = aladinBooks.find((item) => item.isbn13 && item.isbn13 === book.isbn13);
  if (exactIsbn) return exactIsbn;

  return aladinBooks.find((item) => normalizeBookBaseTitle(item.title) === normalizedTitle);
}

async function enrichChildRecommendationsWithAladin(
  client: Data4LibraryClient,
  recommendations: ChildRecommendationCandidate[]
): Promise<ChildRecommendationCandidate[]> {
  return Promise.all(recommendations.map(async (candidate) => {
    const aladin = await findAladinMatch(client, candidate.book).catch(() => undefined);
    return {
      ...candidate,
      aladin
    };
  }));
}

async function buildChildRecommendationRows(
  client: Data4LibraryClient,
  recommendations: ChildRecommendationCandidate[],
  libraries: LibrarySummary[],
  profile: ChildReadingProfile,
  interests: string[]
): Promise<string[][]> {
  return Promise.all(recommendations.map(async (candidate, index) => {
    const holdings = libraries.length > 0
      ? await Promise.all(libraries.map(async (library) => ({
          library,
          exist: candidate.book.isbn13
            ? await client.getBookExist(library.code, candidate.book.isbn13).catch(() => undefined)
            : undefined
        })))
      : [];

    const reasons = [
      `${profile.label} 연령대 인기 대출 ${candidate.ranking}위권`,
      candidate.interestScore > 0 ? `관심사(${interests.join(", ")})와 KDC/도서관 분류 매칭` : "",
      candidate.aladin?.bestRank ? `알라딘 베스트셀러 순위 보조 신호` : "",
      candidate.comicLike ? "" : "일반 지식서/비만화 후보"
    ].filter(Boolean).join("<br>");

    return [
      String(index + 1),
      formatBookTitle(candidate.book),
      reasons || "연령대 대출 데이터 기반",
      formatLibraryHoldings(holdings)
    ];
  }));
}

function formatLibraryHoldings(holdings: Array<{ library: LibrarySummary; exist?: BookExistResult }>): string {
  if (holdings.length === 0) return "도서관 지정 시 확인 가능";
  return holdings.map(({ library, exist }) => (
    `${library.name}: ${formatExistStatus(exist?.hasBook)} / ${formatLoanStatus(exist?.loanAvailable)}`
  )).join("<br>");
}

export function scoreInterestMatch(book: BookSummary, interests: string[]): number {
  if (interests.length === 0) return 0;
  const searchable = libraryRecommendationSearchText(book);
  const bookKdcTags = kdcTagsForBook(book);

  let score = 0;
  for (const interest of interests) {
    const group = kdcGroupForInterest(interest);
    const keywords = group?.keywords ?? [interest];
    const kdcMatched = group ? bookKdcTags.some((tag) => tag.code === group.code) : false;
    if (kdcMatched || keywords.some((keyword) => searchable.includes(normalizeLookupText(keyword)))) {
      score += 120;
    }
  }
  return score;
}

async function getChildPopularBooks(
  client: Data4LibraryClient,
  region: string | undefined,
  ageGroupCode: string,
  interests: string[]
): Promise<ChildPopularBookSource> {
  const kdcCodes = interestKdcCodes(interests);
  if (kdcCodes.length === 0) {
    return {
      books: await client.getPopularBooks(region, ageGroupCode),
      kdcCodes: []
    };
  }

  const subjectBooks: PopularBook[] = [];
  let lastError: unknown;
  for (const kdc of kdcCodes) {
    try {
      subjectBooks.push(...await client.getPopularBooks(region, ageGroupCode, kdc));
    } catch (error) {
      lastError = error;
    }
  }

  const dedupedSubjectBooks = dedupeBooks(subjectBooks);
  if (dedupedSubjectBooks.length >= 5) {
    return { books: dedupedSubjectBooks, kdcCodes };
  }

  try {
    const fallbackBooks = await client.getPopularBooks(region, ageGroupCode);
    return {
      books: mergeBookLists(dedupedSubjectBooks, fallbackBooks),
      kdcCodes
    };
  } catch (error) {
    if (dedupedSubjectBooks.length > 0) return { books: dedupedSubjectBooks, kdcCodes };
    if (lastError instanceof Error) throw lastError;
    throw error;
  }
}

export function interestKdcCodes(interests: string[]): string[] {
  const codes = new Set<string>();
  for (const interest of interests) {
    const group = kdcGroupForInterest(interest);
    if (group) codes.add(group.code);
  }
  return [...codes].slice(0, 2);
}

function formatKdcCode(code: string): string {
  const group = KDC_GROUPS.find((item) => item.code === normalizeKdcCode(code));
  return group ? `${group.code}00 ${group.label}` : code;
}

function kdcGroupForInterest(interest: string): KdcGroup | undefined {
  const normalized = normalizeLookupText(interest);
  if (!normalized) return undefined;
  return KDC_GROUPS.find((group) =>
    normalized.includes(group.label) || group.keywords.some((keyword) => normalized.includes(normalizeLookupText(keyword)))
  );
}

function kdcTagsForBook(book: BookSummary): KdcGroup[] {
  const tags: KdcGroup[] = [];
  const classCode = normalizeKdcCode(book.classNo);
  const codeGroup = classCode ? KDC_GROUPS.find((group) => group.code === classCode) : undefined;
  if (codeGroup) tags.push(codeGroup);

  const className = normalizeLookupText(book.className);
  for (const group of KDC_GROUPS) {
    if (tags.includes(group)) continue;
    if (className.includes(normalizeLookupText(group.label))) {
      tags.push(group);
      continue;
    }
    if (group.keywords.some((keyword) => className.includes(normalizeLookupText(keyword)))) {
      tags.push(group);
    }
  }

  if (tags.length > 0) return tags;

  const searchable = libraryRecommendationSearchText(book);
  for (const group of KDC_GROUPS) {
    if (group.keywords.some((keyword) => searchable.includes(normalizeLookupText(keyword)))) {
      tags.push(group);
    }
  }
  return tags;
}

function normalizeKdcCode(value: string | undefined): string {
  const text = String(value ?? "").trim();
  const match = text.match(/\d/);
  return match?.[0] ?? "";
}

function mergeBookLists<T extends BookSummary>(primary: T[], fallback: T[]): T[] {
  return dedupeBooks([...primary, ...fallback]);
}

function dedupeBooks<T extends BookSummary>(books: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const book of books) {
    const key = book.isbn13 || `${normalizeBookBaseTitle(book.title)}:${normalizeAuthorKey(book.authors)}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(book);
  }
  return result;
}

function buildRecommendationExclusionRules(excludeKeywords: string[], preferNonComic: boolean | undefined): RecommendationExclusionRules {
  const normalizedKeywords = excludeKeywords
    .flatMap((keyword) => {
      const normalized = normalizeLookupText(keyword);
      if (!normalized) return [];
      if (/만화|코믹|학습만화|웹툰/.test(normalized)) {
        return ["만화", "코믹", "학습만화", "웹툰", "흔한남매"];
      }
      return [keyword];
    })
    .map(normalizeLookupText)
    .filter(Boolean);

  return {
    keywords: [...new Set(normalizedKeywords)],
    excludeComics: preferNonComic === true || normalizedKeywords.some((keyword) => /만화|코믹|웹툰/.test(keyword))
  };
}

function matchesRecommendationExclusion(
  book: BookSummary,
  rules: RecommendationExclusionRules
): boolean {
  if (rules.excludeComics && isComicLikeBook(book)) return true;
  if (rules.keywords.length === 0) return false;
  const searchable = libraryRecommendationSearchText(book);
  return rules.keywords.some((keyword) => searchable.includes(keyword));
}

function selectChildRecommendations(
  candidates: ChildRecommendationCandidate[],
  limit: number,
  preferNonComic: boolean
): ChildRecommendationCandidate[] {
  if (candidates.length <= limit) return candidates;

  const nonComics = candidates.filter((candidate) => !candidate.comicLike);
  if (preferNonComic && nonComics.length > 0) {
    return nonComics.slice(0, limit);
  }

  const selected: ChildRecommendationCandidate[] = [];
  const comicLimit = Math.max(1, Math.floor(limit / 3));

  for (const candidate of candidates) {
    const comicCount = selected.filter((item) => item.comicLike).length;
    if (candidate.comicLike && comicCount >= comicLimit && nonComics.length >= limit - comicLimit) continue;
    selected.push(candidate);
    if (selected.length >= limit) return selected;
  }

  for (const candidate of candidates) {
    if (selected.includes(candidate)) continue;
    selected.push(candidate);
    if (selected.length >= limit) break;
  }

  return selected;
}

export function isComicLikeBook(book: BookSummary): boolean {
  const searchable = libraryRecommendationSearchText(book);
  const classCode = book.classNo.trim();
  if (/^6?57/.test(classCode)) return true;
  return /만화|코믹|학습만화|웹툰|흔한남매|쿠키런|카카오프렌즈|놓지마|엉덩이탐정/.test(searchable);
}

function libraryRecommendationSearchText(book: BookSummary): string {
  return normalizeLookupText([
    book.title,
    book.authors,
    book.publisher,
    book.classNo,
    book.className
  ].filter(Boolean).join(" "));
}
