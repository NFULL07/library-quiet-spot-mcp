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
          description: "Maximum number of recommendations. Defaults to 3 and is capped at 5 to reduce upstream API calls."
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
