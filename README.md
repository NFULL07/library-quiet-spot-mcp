# 도서관 책길잡이 MCP (LibraryQuietSpot)

도서관 책길잡이 MCP는 Data4Library(도서관 정보나루) Open API의 실측 데이터를 가공해
"이 책을 어디서 빌릴 수 있는지", "언제 방문하면 덜 붐비는지", "다 읽고 무엇을 읽으면 좋은지"를
MCP 도구로 제공하는 Node.js/TypeScript 서버입니다.

사용자는 도서관 코드를 몰라도 됩니다. `정독도서관`, `마포중앙도서관`처럼 도서관 이름으로 질문하면
서버가 내부적으로 도서관 코드를 찾아 기존 정보나루 데이터를 조회합니다.

단순 API 래핑이 아니라, 원본 데이터 위에 사용자가 바로 판단할 수 있는 계산 결과를 얹는 것을 목표로 했습니다.

## Problem

도서관 데이터는 공개되어 있지만 일반 사용자가 바로 활용하기에는 몇 가지 장벽이 있습니다.

- 인기 도서, 소장 여부, 이용 분석 데이터가 서로 다른 API로 흩어져 있습니다.
- API 응답은 XML 중심이라 LLM 도구 응답으로 그대로 보여주기 어렵습니다.
- 일반 사용자는 정보나루 도서관 코드를 알기 어렵습니다.
- "언제 가면 한산한가", "이 책 다음에 무엇을 읽을까" 같은 질문은 원본 조회만으로는 답하기 어렵습니다.

이 프로젝트는 공개 도서관 데이터를 MCP 도구 형태로 연결하고, 결과를 Markdown으로 정리해 대화형 사용 경험에 맞게 제공합니다.

## Features

| Tool | What it does |
|---|---|
| `find_best_visit_time` | 도서관 이름을 검색해 이용 추이 데이터를 찾고, 상대적으로 한산한 방문 시간대를 계산합니다. |
| `find_trending_books_and_library_match` | 지역 인기 도서 상위 5권을 지정 도서관 이름의 소장 여부와 함께 보여줍니다. |
| `generate_data_driven_reading_roadmap` | ISBN 기반 이용 분석에서 함께 대출된 책, 마니아 추천, 다독자 추천을 분리해 정리합니다. |

## Design Highlights

- **Data-driven only**: 추천 문구를 임의 생성하지 않고 Data4Library API 응답에 있는 실측 지표만 사용합니다.
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

## Local Run

```powershell
npm.cmd install
Copy-Item .env.example .env
# Fill DATA4LIBRARY_AUTH_KEY in .env
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
| `PORT` | no | `3000` | HTTP server port |
| `CACHE_TTL_SECONDS` | no | `21600` | Per-request API cache TTL |
| `REQUEST_TIMEOUT_MS` | no | `2500` | Upstream API timeout |

The server can start and expose tool metadata without an API key. Tool calls that need live data return a clear setup message until `DATA4LIBRARY_AUTH_KEY` is configured.

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
