# Engineering Hardening Notes

이 문서는 정적 코드 리뷰에서 발견된 위험을 어떻게 재현하고, 어떤 설계로 수정했으며, 무엇으로 검증했는지 설명합니다. 각 항목은 Git 커밋 단위와 대응하므로 포트폴리오 리뷰나 면접에서 변경 이유를 추적할 수 있습니다.

## 1. 핵심 도메인 로직 회귀 테스트

Commit: `1b6c25a test(domain): lock core recommendation and visit rules`

### 문제

연령/학년 해석, KDC 관심사 매칭, 도서관 이름 선택, 운영시간 파싱, 한산도 백분위처럼 서비스의 판단을 만드는 코드에 자동 테스트가 없었습니다. 특히 문자열 포함 순서 때문에 `미소장`의 `소장`을 먼저 발견하면 소장 도서로 오판할 수 있었습니다.

### 선택한 설계

- 기존 `tsx`와 Node 내장 테스트 러너를 사용해 새 테스트 프레임워크 의존성을 만들지 않았습니다.
- 순수 도메인 함수를 직접 검증하고 테스트 코드도 strict TypeScript 검사 대상에 포함했습니다.
- 한국어 부정 상태를 긍정 부분 문자열보다 먼저 판정하도록 availability parser를 수정했습니다.

### 검증

나이/학년, KDC, 만화 판별, 도서관 모호성, 한산도 순위, 운영시간, 지역 코드, XML 필드 정규화, API 내부 오류, 거리 계산을 테스트합니다.

### 설명 포인트

테스트를 단순 추가한 것이 아니라 테스트가 실제 `미소장 -> 소장` 오판 가능성을 드러냈고, 부정 토큰 우선이라는 명시적 파싱 규칙으로 고정했습니다.

## 2. 동시 요청의 stale metadata 격리

Commit: `b38f475 fix(client): isolate fallback metadata per request`

### 문제

싱글턴 `Data4LibraryClient`의 mutable `staleNotices` 배열을 모든 요청이 공유했습니다. A 요청이 추가한 notice를 B 요청이 먼저 소비할 수 있어 데이터 출처 안내가 다른 사용자 응답에 섞이는 경쟁 조건이 있었습니다.

### 선택한 설계

- Node `AsyncLocalStorage`를 사용해 요청마다 `requestId`와 `staleNotices`를 소유하게 했습니다.
- 클라이언트는 요청 상태를 보관하지 않고 현재 async context에만 fallback metadata를 기록합니다.
- `fetch`를 주입 가능하게 만들어 외부 API 키나 호출량 없이 HTTP 계약을 재현했습니다.

### 검증

같은 클라이언트에서 A와 B 검색을 동시에 실행합니다. A만 503과 stale fallback을 겪게 한 뒤 A context에는 notice 1개, B context에는 0개임을 확인합니다. Data4Library XML, Kakao `KakaoAK` 헤더/좌표, Aladin ISBN 응답도 contract test로 고정했습니다.

### 설명 포인트

락으로 전역 배열 접근 순서만 제어하면 notice의 소유권 문제는 남습니다. 상태 자체를 request scope로 이동해 공유 대상에서 제거했습니다.

## 3. bounded LRU와 stale 수명주기

Commit: `5c29ac5 feat(cache): bound stale storage with LRU eviction`

### 문제

fresh TTL이 지난 항목도 stale fallback을 위해 Map에 무기한 남았고 최대 크기도 없었습니다. 검색어가 계속 달라지면 장기 실행 프로세스의 메모리가 계속 증가할 수 있었습니다.

### 선택한 설계

- fresh TTL과 stale 추가 보존 기간을 분리했습니다.
- stale 기간까지 끝난 항목은 조회, 쓰기, 크기 확인 시 정리합니다.
- Map 접근 순서를 갱신해 최대 엔트리 초과 시 least recently used 항목을 제거합니다.
- 시계를 주입해 시간 대기 없는 결정적 테스트를 만들었습니다.

### 검증

fresh hit, stale hit, stale 만료 삭제, LRU touch, 최대 크기 유지, 쓰기 중 정리를 각각 검증합니다.

### 설명 포인트

TTL 만료 즉시 삭제는 장애 fallback 요구와 충돌합니다. `fresh -> stale-only -> deleted`의 3단계 수명주기를 정의해 신뢰성과 메모리 제한을 함께 만족시켰습니다.

## 4. 도구 모듈 책임 분리

Commit: `a6099f2 refactor(tools): split dispatch from domain services`

### 문제

약 1,900줄의 `tools.ts`가 MCP schema, argument parsing, 어린이 추천, 방문 계획, 도서관/도서 식별, Markdown 생성을 모두 담당했습니다.

### 선택한 설계

- `tools.ts`: 161줄의 argument parsing과 dispatch
- `tools/definitions.ts`: MCP schema와 annotation
- `services/child-recommendation.ts`: 연령/KDC/소장 결합 추천
- `services/library-visit.ts`: 주변 검색, 방문 시간, 인기 도서, 독서 로드맵
- `services/resolvers.ts`: 도서관 이름과 책 제목/ISBN의 모호성 정책

### 검증

리팩터링 전후에 동일한 unit/contract test, strict typecheck, production build를 실행했습니다. 의도한 사용자 응답 변경은 없습니다.

### 설명 포인트

파일 크기만 줄인 것이 아니라 변경 이유가 서로 다른 세 축, 즉 MCP 계약, 서비스 orchestration, entity resolution을 분리했습니다.

## 5. 구조화 로그와 request ID

Commit: `939d252 feat(observability): correlate HTTP and MCP tool logs`

### 문제

장애가 발생해도 어떤 HTTP 요청이 어떤 MCP Tool을 실행했고 얼마나 걸렸는지 연결할 수 없었습니다.

### 선택한 설계

- 안전한 외부 `x-request-id`는 유지하고, 잘못된 값은 UUID로 교체합니다.
- 같은 ID를 HTTP 완료와 MCP Tool 완료 JSON 로그에 사용합니다.
- 상태 코드, 지연시간, 출력 글자 수, stale fallback 개수만 기록합니다.
- 사용자 질문 원문, Tool arguments, API 키, 응답 내용은 로그에 남기지 않습니다.
- Express app factory와 process startup을 분리해 실제 HTTP integration test를 가능하게 했습니다.

### 검증

임시 포트의 실제 서버에서 request ID 응답 헤더와 완료 로그가 일치하는지, 위험한 ID가 교체되는지, Error가 JSON 구조로 정규화되는지 확인합니다.

## 6. 선택적 retry와 provider별 circuit breaker

Commit: `adeb891 feat(resilience): protect upstreams with retry and circuits`

### 문제

일시적 503도 즉시 사용자 실패가 되었고, 반대로 일일 쿼터 오류가 반복될 때는 실패할 요청을 계속 보내 호출량과 지연을 키울 수 있었습니다.

### 선택한 설계

- timeout, 네트워크 오류, 선택된 5xx만 bounded exponential backoff로 재시도합니다.
- 429는 짧은 `Retry-After`가 있을 때만 재시도합니다.
- 정보나루의 HTTP 200 내부 쿼터 오류는 재시도하지 않습니다.
- Data4Library, Kakao, Aladin 회로를 분리해 한 공급자의 장애가 다른 공급자를 막지 않게 했습니다.
- 회로가 열리면 정보나루는 기존 stale cache 경로로 빠르게 전환합니다.

### 검증

503 후 성공, backoff delay, quota형 429 무재시도, 정보나루 내부 오류 누적 후 open, open 상태에서 fetch 미실행, half-open 성공 후 close를 검증합니다.

### 설명 포인트

재시도 자체보다 분류가 중요합니다. 복구 가능성이 짧은 오류만 재시도해 공공 API 일일 쿼터를 보호했습니다.

## 7. HTTP 경계와 컨테이너 보안

Commit: `d170158 security(http): harden the public MCP boundary`

### 문제

애플리케이션 수준의 Host/Origin 검증과 rate limit이 없었고, runtime image가 root로 실행됐습니다. 의존성 감사에서는 새로 공개된 취약점도 발견됐습니다.

### 선택한 설계

- `/mcp`에 Host allowlist, 제공된 Origin 검증, JSON content type, per-IP process-local rate limit을 적용했습니다.
- Kubernetes probe 호환성을 위해 `/health`, `/ready`는 Host 제한에서 제외했습니다.
- 보안 헤더를 추가하고 Express 식별 헤더를 제거했습니다.
- 호환 범위 안에서 잠금 파일을 갱신해 감사 취약점을 제거했습니다.
- Docker runtime을 Alpine 기본 `node` 사용자로 실행합니다.

### 검증

실제 HTTP에서 악성 Host/Origin 403, 잘못된 media type 415, 초과 요청 429를 확인했습니다. `npm audit --omit=dev`는 0건이며, Docker 이미지를 빌드하고 `Config.User=node`를 확인했습니다.

### 트레이드오프

현재 limiter는 단일 프로세스 기준입니다. 여러 replica로 확장할 경우 PlayMCP gateway 또는 Redis 기반 분산 limiter로 교체해야 합니다.

## 8. CI, 장애 주입, bounded load smoke

Commit: `ci(quality): enforce checks and failure scenarios`

### 문제

로컬에서 검증해도 이후 커밋이 typecheck/test/build를 생략하면 회귀가 main에 들어갈 수 있었습니다. 또한 정상 응답 테스트만으로는 circuit과 stale cache의 연계 동작을 증명하기 어려웠습니다.

### 선택한 설계

- GitHub Actions에서 Node 22, `npm ci`, typecheck, test, build, production audit를 강제합니다.
- 외부 API를 호출하지 않는 `tools/list` 요청으로 실제 MCP transport의 bounded load smoke를 실행합니다.
- 실패 주입 테스트에서 정상 cache warm-up, 503, circuit open, stale fallback, stale 만료, timeout을 순서대로 재현합니다.

### 검증

로컬 bounded load 결과:

- 총 요청: 40
- 동시성: 5
- 성공: 40, 실패: 0
- 처리량: 약 444 req/s
- p95: 약 30 ms

수치는 개발 PC의 작은 smoke 결과이며 서비스 용량 보장이 아닙니다. 목적은 동시 transport 처리의 오류와 명백한 지연 회귀를 CI에서 빠르게 발견하는 것입니다.

## 전체 검증 명령

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd audit --omit=dev
```

로컬 서버를 실행한 뒤 bounded load smoke를 수행합니다.

```powershell
npm.cmd run test:load
```

실제 API smoke는 일일 호출량을 소비하므로 명시적으로만 실행합니다.

```powershell
$env:RUN_LIVE_API_TESTS = "1"
npm.cmd run test:live
```
