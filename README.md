# 도서관 책길잡이 MCP (Library Book Guide)

![도서관 책길잡이 대표 이미지](assets/playmcp-cover.png)

도서관 책길잡이 MCP는 Data4Library(도서관 정보나루) Open API의 실측 데이터를 가공해
"내 위치 주변에 어떤 도서관이 있는지", "읽고 싶은 책을 빌리러 도서관에 가도 되는지", "그 김에 같이 빌릴 다음 책은 무엇인지",
"다 읽고 무엇을 읽으면 좋은지"를 MCP 도구로 제공하는 Node.js/TypeScript 서버입니다.

사용자는 도서관 코드를 몰라도 됩니다. `정독도서관`, `마포중앙도서관`처럼 도서관 이름으로 질문하면
서버가 내부적으로 도서관 코드를 찾아 기존 정보나루 데이터를 조회합니다.

단순 API 래핑이 아니라, 원본 데이터 위에 사용자가 바로 판단할 수 있는 계산 결과를 얹는 것을 목표로 했습니다.

## Problem

도서관 데이터는 공개되어 있지만 일반 사용자가 바로 활용하기에는 몇 가지 장벽이 있습니다.

- 인기 도서, 소장 여부, 이용 분석 데이터가 서로 다른 API로 흩어져 있습니다.
- API 응답은 XML 중심이라 LLM 도구 응답으로 그대로 보여주기 어렵습니다.
- 일반 사용자는 정보나루 도서관 코드를 알기 어렵습니다.
- "내 주변에 어떤 도서관이 있나", "이 책을 빌리러 이 도서관에 가도 될까", "간 김에 무엇을 같이 빌릴까" 같은 질문은 원본 조회만으로는 답하기 어렵습니다.

이 프로젝트는 공개 도서관 데이터를 MCP 도구 형태로 연결하고, 결과를 Markdown으로 정리해 대화형 사용 경험에 맞게 제공합니다.

## Features

| Tool | What it does |
|---|---|
| `recommend_books_for_child` | 자녀의 나이/학년과 관심사를 바탕으로 정보나루 연령대별 대출 데이터와 한국십진분류표(KDC) 주제분류를 조회해 추천합니다. 알라딘 서점 메타데이터는 ISBN 매칭된 후보의 표지·소개·베스트셀러 순위 등 추천 보강 신호로만 사용합니다. 지정 도서관 또는 주변 도서관 소장 여부도 함께 확인하며, `prefer_non_comic`/`exclude_keywords`로 만화책 제외 같은 취향 조건을 반영할 수 있습니다. |
| `find_nearby_libraries` | 장소명 또는 위도/경도를 기준으로 주변 도서관을 거리순으로 찾고 운영시간 기반 방문 후보를 함께 보여줍니다. |
| `plan_library_reading_visit` | 기준 책의 소장/대출 가능 여부, 같은 도서관에서 같이 빌릴 다음 책 후보, 방문 시간 후보를 하나의 방문 플랜으로 묶습니다. |
| `find_best_visit_time` | 도서관 이름을 검색해 이용 추이 데이터가 있으면 상대적으로 한산한 시간대를 계산하고, 없으면 운영시간 기반 방문 후보를 제공합니다. |
| `find_trending_books_and_library_match` | 지역 인기 도서 상위 5권을 지정 도서관의 소장/대출 가능 여부와 함께 보여줍니다. |
| `generate_data_driven_reading_roadmap` | ISBN 기반 이용 분석에서 함께 대출된 책, 마니아 추천, 다독자 추천을 분리해 정리합니다. |

## Design Highlights

- **Data-grounded answers**: 추천 도서와 소장 여부는 Data4Library API 응답을 사용하고, 방문 후보는 공식 운영시간을 파싱해 계산합니다.
- **Bookstore-augmented recommendations**: `ALADIN_TTB_KEY`가 설정되면 알라딘 OpenAPI의 책 소개, 표지, 베스트셀러 순위를 추천 후보의 보조 신호로만 사용합니다. 분야 태그와 관심사 매칭은 정보나루 도서 정보와 한국십진분류표(KDC)를 기준으로 계산합니다.
- **Location-aware discovery**: 카카오 Local API 장소명 검색 또는 위도/경도 좌표를 기준으로 주변 도서관을 거리순으로 정렬합니다.
- **Reading-visit planning**: 단일 책 검색에서 끝내지 않고, 목표 도서와 다음 독서 후보의 같은 도서관 소장 여부를 함께 확인합니다.
- **Name-first UX**: 도서관 이름을 입력받아 내부적으로 `libSrch` 검색 결과의 도서관 코드로 변환합니다.
- **MCP-ready transport**: Streamable HTTP 기반 MCP 서버로 구현했습니다.
- **Stateless startup**: 서버는 먼저 포트를 열고, 인증키나 외부 API 상태와 무관하게 `tools/list`가 동작하도록 구성했습니다.
- **XML normalization**: XML 파서가 0건, 1건, 다건을 다르게 반환하는 문제를 `ensureArray`와 빈 값 정규화로 방어합니다.
- **Safe output**: MCP 응답은 TextContent + Markdown만 반환하고, 20,000자 제한 가드로 과도한 응답을 차단합니다.
- **Secret hygiene**: API 키는 환경변수로만 주입하며 `.env`와 `.env.*`는 Git 추적에서 제외합니다.

자세한 설계 판단은 [docs/design-decisions.md](docs/design-decisions.md)에 정리했습니다.

## Architecture

```text
Client / MCP Host
      |
      | POST /mcp
      v
Express + StreamableHTTPServerTransport
      |
      v
MCP tool handlers
      |
      v
Data4Library client
      |
      +-- Library-name resolver
      +-- TTL cache
      +-- XML parser
      +-- Markdown formatter
```

## Example Prompts

```text
초등학교 3학년 아이가 과학 좋아하는데 책 추천해줘
```

```text
대전역 근처에서 초등학교 3학년 과학책 추천해줘. 만화책 말고
```

```text
내 위치 주변 도서관 찾아줘
```

```text
마포중앙도서관에 아몬드 빌리러 가도 될까?
```

```text
정독도서관 한산한 시간 알려줘
```

```text
마포중앙도서관에 요즘 인기책 있어?
```

```text
아몬드 읽고 다음 책 추천해줘
```

## Tech Stack

- Node.js 20+
- TypeScript
- Express
- `@modelcontextprotocol/sdk`
- `fast-xml-parser`
- Data4Library Open API
- Kakao Local API
- Aladin OpenAPI

## Local Run

```powershell
npm.cmd install
Copy-Item .env.example .env
# Fill DATA4LIBRARY_AUTH_KEY in .env
# Fill KAKAO_REST_API_KEY too if you want place-name search.
# Fill ALADIN_TTB_KEY too if you want bookstore metadata augmentation.
npm.cmd run build
npm.cmd start
```

Default endpoints:

- `GET /health`
- `GET /ready`
- `POST /mcp`

`GET /mcp` and `DELETE /mcp` return `405` because this server is designed for stateless Streamable HTTP.

## Environment Variables

| Name | Required | Default | Description |
|---|---:|---:|---|
| `DATA4LIBRARY_AUTH_KEY` | yes | | Data4Library Open API key |
| `KAKAO_REST_API_KEY` | no | | Kakao Local REST API key for place-name search |
| `ALADIN_TTB_KEY` | no | | Aladin OpenAPI TTB key for bookstore metadata augmentation |
| `PORT` | no | `3000` | HTTP server port |
| `CACHE_TTL_SECONDS` | no | `21600` | Per-request API cache TTL |
| `REQUEST_TIMEOUT_MS` | no | `5000` | Upstream API timeout |

The server can start and expose tool metadata without an API key. Tool calls that need live Data4Library data return a clear setup message until `DATA4LIBRARY_AUTH_KEY` is configured. Place-name search, such as `홍대입구역 근처 도서관`, additionally requires `KAKAO_REST_API_KEY`; coordinate-based nearby search still works without it. Aladin augmentation is optional; without `ALADIN_TTB_KEY`, child recommendations still use Data4Library age-group loan data.

## Validation

```powershell
npm.cmd run build
npm.cmd audit --omit=dev
```

Both commands should pass before deployment.

## Security Notes

- Do not commit `.env` or real API keys.
- `.env.example` intentionally contains only placeholder values.
- Cache keys exclude the API key to avoid retaining credentials in process memory longer than necessary.
- Tool output never returns raw upstream JSON/XML dumps.

## License

MIT
