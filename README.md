# LibraryQuietSpot MCP

Data4Library(도서관 정보나루) Open API의 실측 데이터를 가공해 도서관 방문 시간과 독서 추천 흐름을 제공하는 Streamable HTTP MCP 서버입니다.

## Tools

- `find_best_visit_time`: 도서관별 대출반납 추이를 바탕으로 한산한 방문 시간 TOP 3를 계산합니다.
- `find_trending_books_and_library_match`: 지역 인기 도서 상위 5권을 지정 도서관 소장 여부와 함께 보여줍니다.
- `generate_data_driven_reading_roadmap`: ISBN의 이용 분석 데이터에서 함께 대출된 책, 마니아 추천, 다독자 추천을 분리해 보여줍니다.

## Local Run

```powershell
npm.cmd install
Copy-Item .env.example .env
# .env에 DATA4LIBRARY_AUTH_KEY 입력
npm.cmd run build
npm.cmd start
```

기본 엔드포인트:

- `GET /health`
- `GET /ready`
- `POST /mcp`

`GET /mcp`, `DELETE /mcp`는 stateless Streamable HTTP 운영을 위해 `405`를 반환합니다.

## Environment

| Name | Required | Default | Description |
|---|---:|---:|---|
| `DATA4LIBRARY_AUTH_KEY` | yes | | Data4Library Open API key |
| `PORT` | no | `3000` | HTTP server port |
| `CACHE_TTL_SECONDS` | no | `21600` | Per-request API cache TTL |
| `REQUEST_TIMEOUT_MS` | no | `2500` | Upstream API timeout |

인증키가 없어도 서버와 `tools/list`는 성공합니다. 실제 도구 호출은 안내 메시지를 반환합니다.
