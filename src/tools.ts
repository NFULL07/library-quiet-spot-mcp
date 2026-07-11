import { Data4LibraryClient, MissingAuthKeyError, MissingKakaoRestApiKeyError, BookSummary, PopularBook, TrendPoint, LibrarySummary, UsageAnalysis, BookExistResult, NearbyLibrary, PlaceSummary, AladinBook } from "./data4library.js";
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
    name: "recommend_books_for_child",
    description:
      "Library Visit Reading Guide(도서관 방문 독서 길잡이) recommends child-appropriate books from Data4Library age-group loan data, optionally augments candidates with Aladin metadata, and checks library holdings.",
    inputSchema: {
      type: "object",
      properties: {
        age: {
          type: "number",
          description: "Child age, such as 9."
        },
        grade: {
          type: "string",
          description: "Child grade, school stage, or age phrase, such as 초3, 초등학교 3학년, 초등 저학년, 7살, 만 5세, 중1, 고2."
        },
        interests: {
          type: "string",
          description: "Optional interests as comma-separated Korean keywords, such as 과학, 모험, 역사, 그림책."
        },
        prefer_non_comic: {
          type: "boolean",
          description: "Set true when the user asks for non-comic books, for example 만화책 말고, 학습만화 제외, 일반 과학책."
        },
        exclude_keywords: {
          type: "string",
          description: "Optional comma-separated keywords or genres to exclude from recommendations, such as 만화, 흔한남매, 판타지."
        },
        library_name: {
          type: "string",
          description: "Optional library name to check holdings."
        },
        library_code: {
          type: "string",
          description: "Optional Data4Library library code. Use only when already known."
        },
        place_name: {
          type: "string",
          description: "Optional explicit place name to find nearby libraries, such as 부산 서면역 or 대구 동성로. Requires KAKAO_REST_API_KEY. Do not invent a place when the user did not provide one."
        },
        latitude: {
          type: "number",
          description: "Optional latitude for nearby-library search when place_name is not provided."
        },
        longitude: {
          type: "number",
          description: "Optional longitude for nearby-library search when place_name is not provided."
        },
        region: {
          type: "string",
          description: "Optional Data4Library region code. If omitted, the tool infers it from a resolved library address when possible."
        },
        limit: {
          type: "number",
          description: "Maximum number of recommendations. Defaults to 5 and is capped at 8."
        }
      },
      additionalProperties: false
    },
    annotations: {
      title: "Recommend books for a child",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
      idempotentHint: true
    }
  },
  {
    name: "find_nearby_libraries",
    description:
      "Library Visit Reading Guide(도서관 방문 독서 길잡이) finds nearby libraries from a place name or latitude/longitude using Kakao Local and Data4Library(도서관 정보나루).",
    inputSchema: {
      type: "object",
      properties: {
        place_name: {
          type: "string",
          description: "Place name to search around, such as 홍대입구역 or 서울시청. Requires KAKAO_REST_API_KEY."
        },
        latitude: {
          type: "number",
          description: "Current latitude, for example 37.5665. Used when place_name is not provided."
        },
        longitude: {
          type: "number",
          description: "Current longitude, for example 126.9780. Used when place_name is not provided."
        },
        radius_km: {
          type: "number",
          description: "Search radius in kilometers. Defaults to 5 and is capped at 30."
        },
        limit: {
          type: "number",
          description: "Maximum number of libraries to return. Defaults to 10 and is capped at 20."
        }
      },
      additionalProperties: false
    },
    annotations: {
      title: "Find nearby libraries",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
      idempotentHint: true
    }
  },
  {
    name: "plan_library_reading_visit",
    description:
      "Library Visit Reading Guide(도서관 방문 독서 길잡이) creates a reading-visit plan with target book availability, next-reading recommendations, same-library holdings, and visit windows.",
    inputSchema: {
      type: "object",
      properties: {
        library_name: {
          type: "string",
          description: "Library name to visit, such as 정독도서관 or 마포중앙도서관."
        },
        library_code: {
          type: "string",
          description: "Optional Data4Library library code. Use this only when the code is already known."
        },
        book_title: {
          type: "string",
          description: "Book title that the user wants to read or borrow, such as 아몬드."
        },
        isbn: {
          type: "string",
          description: "Optional ISBN-13 of the target book when already known."
        }
      },
      additionalProperties: false
    },
    annotations: {
      title: "Plan a library reading visit",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
      idempotentHint: true
    }
  },
  {
    name: "find_best_visit_time",
    description:
      "Library Visit Reading Guide(도서관 방문 독서 길잡이) plans practical library visit windows from Data4Library(도서관 정보나루) usageTrend or official operating hours.",
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
      "Library Visit Reading Guide(도서관 방문 독서 길잡이) finds popular books from Data4Library(도서관 정보나루), checks named-library holdings, and adds visit-window guidance.",
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
      "Library Visit Reading Guide(도서관 방문 독서 길잡이) builds a next-reading roadmap from a title or ISBN using Data4Library(도서관 정보나루) co-loan, mania, and reader recommendation data.",
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
      case "recommend_books_for_child":
        return guardMarkdown(
          await recommendBooksForChild(
            client,
            optionalNumber(args, "age"),
            optionalString(args, "grade"),
            optionalStringList(args, "interests"),
            optionalBoolean(args, "prefer_non_comic"),
            optionalStringList(args, "exclude_keywords"),
            optionalString(args, "library_name"),
            optionalString(args, "library_code"),
            optionalString(args, "place_name"),
            optionalNumber(args, "latitude"),
            optionalNumber(args, "longitude"),
            optionalString(args, "region"),
            optionalNumber(args, "limit")
          )
        );
      case "find_nearby_libraries":
        return guardMarkdown(
          await findNearbyLibraries(
            client,
            optionalString(args, "place_name"),
            optionalNumber(args, "latitude"),
            optionalNumber(args, "longitude"),
            optionalNumber(args, "radius_km"),
            optionalNumber(args, "limit")
          )
        );
      case "plan_library_reading_visit":
        return guardMarkdown(
          await planLibraryReadingVisit(
            client,
            optionalString(args, "library_name"),
            optionalString(args, "library_code"),
            optionalString(args, "book_title"),
            optionalString(args, "isbn")
          )
        );
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

async function recommendBooksForChild(
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

  const safeLimit = Math.round(clampNumber(limit ?? 5, 3, 8));
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

  const augmented = await Promise.all(
    popularBooks.slice(0, 50).map(async (book, index) => {
      const aladin = await findAladinMatch(client, book).catch(() => undefined);
      const interestScore = scoreInterestMatch(book, interests);
      const aladinBoost = aladin?.bestRank ? Math.max(0, 80 - Math.min(aladin.bestRank, 80)) : 0;
      const comicLike = isComicLikeBook(book);
      const excluded = matchesRecommendationExclusion(book, exclusionRules);
      const comicPenalty = comicLike ? (preferNonComic ? 600 : 240) : 0;
      return {
        book,
        ranking: book.ranking ?? index + 1,
        aladin,
        interestScore,
        comicLike,
        excluded,
        score: 1000 - ((book.ranking ?? index + 1) * 14) + interestScore + aladinBoost - comicPenalty
      };
    })
  );

  const filtered = augmented.filter((candidate) => !candidate.excluded);
  const sortedCandidates = (filtered.length > 0 ? filtered : augmented)
    .sort((a, b) => b.score - a.score || a.ranking - b.ranking)
  const recommendations = selectChildRecommendations(sortedCandidates, safeLimit, preferNonComic === true);

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

async function findNearbyLibraries(
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

async function findBestVisitTime(
  client: Data4LibraryClient,
  libraryName: string | undefined,
  libraryCode: string | undefined
): Promise<string> {
  const resolved = await resolveSingleLibrary(client, libraryName, libraryCode);
  if (resolved.kind === "message") return resolved.markdown;

  return renderBestVisitTime(client, resolved.library);
}

async function planLibraryReadingVisit(
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

function resolveChildReadingProfile(age: number | undefined, grade: string | undefined): ChildReadingProfile | undefined {
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

function scoreInterestMatch(book: BookSummary, interests: string[]): number {
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

function interestKdcCodes(interests: string[]): string[] {
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

function isComicLikeBook(book: BookSummary): boolean {
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
        imageUrl: "",
        classNo: "",
        className: ""
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

function collectCompanionBooks(analysis: UsageAnalysis | undefined): Array<{ source: string; book: BookSummary }> {
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

function formatExistStatus(value: BookExistResult["hasBook"]): string {
  if (value === true) return "소장";
  if (value === false) return "미소장";
  return "확인 필요";
}

function formatLoanStatus(value: BookExistResult["loanAvailable"]): string {
  if (value === true) return "가능";
  if (value === false) return "불가";
  return "도서관 확인";
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

function formatPlace(place: PlaceSummary): string {
  const address = place.roadAddress || place.address;
  return address ? `${place.name} - ${address}` : place.name;
}

function firstVisitCandidate(library: NearbyLibrary): string {
  const [candidate] = buildOperatingHourVisitCandidates(library.operatingTime);
  return candidate ? `${candidate.label} ${candidate.time}` : "운영시간 확인 필요";
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

function optionalStringList(args: Record<string, unknown>, key: string): string[] {
  const value = args[key];
  if (value === undefined || value === null) return [];
  const rawValues = Array.isArray(value) ? value : String(value).split(/[,/]/);
  return rawValues
    .map((item) => String(item).trim())
    .filter(Boolean)
    .slice(0, 6);
}

function optionalNumber(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

function optionalBoolean(args: Record<string, unknown>, key: string): boolean | undefined {
  const value = args[key];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "boolean") return value;
  const normalized = normalizeLookupText(String(value));
  if (/^(true|1|yes|y|on|사용|예|네|맞음)$/.test(normalized)) return true;
  if (/^(false|0|no|n|off|미사용|아니오|아니요|아님)$/.test(normalized)) return false;
  return undefined;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function isValidLatitude(value: number): boolean {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

function isValidLongitude(value: number): boolean {
  return Number.isFinite(value) && value >= -180 && value <= 180;
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

  if (error instanceof MissingKakaoRestApiKeyError) {
    return [
      "장소명 검색을 위해 카카오 Local API 키가 필요합니다.",
      "",
      "- 환경변수 `KAKAO_REST_API_KEY`를 설정하면 `홍대입구역 근처 도서관 찾아줘`처럼 장소명으로 검색할 수 있습니다.",
      "- 키가 없어도 `latitude`, `longitude`를 직접 입력하면 주변 도서관 검색은 사용할 수 있습니다."
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
