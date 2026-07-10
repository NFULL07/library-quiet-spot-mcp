# 도서관 MCP 개발 가이드라인

**작성일** 2026-07-09
**목적** Codex로 도서관 MCP를 직접 개발하기 위한 단일 참조 문서
**공모전** 카카오 Agentic Player 10 (예선 마감 7/14) — 정보나루 「2026 도서관 데이터 활용 공모전」(8/7 마감)에도 재활용 가능

이 문서 하나로 개발이 끝나야 한다. 외부 문서를 다시 찾을 필요 없게 확정된 사실만 담았다.
**추측으로 채운 곳은 전부 "미확인"이라고 명시했다. 그 부분은 실제 호출로 직접 확인할 것.**

---

## 0. 왜 이 설계인가 (한 줄 요약)

> 이 책 우리 동네 어느 도서관에 있고, 언제 가면 안 밀리고, 다 읽으면 다음엔 뭘 읽나.

기존 `data4library-mcp`(github.com/isnow890/data4library-mcp, 25개 도구)가 정보나루 API를 이미 전부 래핑했다. 소장 검색, 대출 가능 여부, 인기도서, GPS 주변 도서관까지 있다. **이 서버는 그것과 겹치면 안 된다.**

25개 도구가 전부 "조회"인 반면, 아무도 "계산된 판단"을 반환하지 않는다. 이 서버의 자리는 그 위 레이어다: 원본 데이터를 그대로 넘기지 않고 **가공**한다.

---

## 1. 절대 준수 — PlayMCP 기술 제약

### 1.1 프로토콜
- MCP 스펙 버전 **2025-03-26 ~ 2025-11-25**
- **Streamable HTTP만.** SSE 절대 금지
- Remote MCP 서버, 공개 URL 필수
- **Stateless 권장** (no session) — `sessionIdGenerator: undefined`로 구성

### 1.2 서버 기동 순서 — 회수식품 서버에서 실패했다가 고친 부분
```
❌ 잘못된 순서: await 캐시적재() → app.listen()
✅ 올바른 순서: app.listen() 먼저 → 캐시는 백그라운드로 적재
```
이유: 카카오 클라우드 콜드스타트 헬스체크와 PlayMCP의 "정보 불러오기"(`tools/list` 호출)는
**캐시가 없어도 성공해야 한다.** 캐시 적재를 기다리다 포트를 늦게 열면 배포/등록이 실패한다.

각 도구는 캐시 미적재 시 예외를 던지지 말고 **안내 텍스트를 반환**해야 한다:
```
"데이터를 적재하는 중입니다. 잠시 후 다시 시도해 주세요."
```
PlayMCP가 도구 오류로 잡으면 안 되기 때문이다.

### 1.3 명명 규칙
- 도구 이름: 1~128자, `A-Z a-z 0-9 _ -` 만 허용, 대소문자 구분
- **`kakao` 를 이름·설명·변수 어디에도 prefix/suffix/중간 포함 전부 금지** (대소문자 무관)
- MCP 이름에 `AI`, `Bot`, `Service` 같은 중복 키워드 지양
- MCP 식별자(prefix)는 영문·숫자만. 툴 이름 앞에 자동 부착되므로 **도구 이름에 서비스명을 넣지 말 것**

### 1.4 도구 개수
- 권장 3~10개 (개발가이드), 정책상 3~20개 허용
- 과도하게 많으면 LLM의 툴콜 정확도가 떨어짐 → 지금 설계는 **4개**로 충분

### 1.5 필수 속성
모든 도구에 `name`, `description`, `inputSchema`, `annotations` 4가지 필수.

`annotations`는 5개 전부 값 지정 필수:
```
title, readOnlyHint, destructiveHint, openWorldHint, idempotentHint
```
이 서버는 전부 조회/계산이므로 기본값:
```js
{ readOnlyHint: true, destructiveHint: false, idempotentHint: true }
```
`openWorldHint`는 도구별로 다름 (아래 4장 참조).

### 1.6 description 작성 규칙
- 영문 권장, **1,024자 이내**
- **서비스명을 영·국문 병기**해야 함
  - 공식 예시: `Retrieves a list of the current most popular or trending songs from Melon(멜론)`
- 이 서버의 서비스명: **LibraryQuietSpot(도서관혼잡도)** 또는 팀에서 확정한 이름으로 병기

### 1.7 응답 형식
- `content`는 **TextContent 타입만** 허용
- **Markdown 권장. API 응답을 JSON 그대로 문자열화 금지**
- **Response 24k(24,000자) 초과 시 에러 처리 → 반려 사유.** 안전 마진 두고 20,000자에서 절단
- 이미지는 마크다운 문법으로 URL 삽입: `![설명](URL)`

### 1.8 성능
- **툴 응답속도 평균 100ms 이내, p99 3,000ms 필수**
- 외부 API를 도구 호출 경로에서 직접 부르면 절대 못 맞춘다 → **캐싱 필수** (2장 참조)

---

## 2. 절대 준수 — 반려 사유 (심사정책)

### 2.1 "LLM 웹 검색으로 구현 가능" — 가장 위험한 조항
> LLM이 자체 웹 검색을 통해 충분히 구현 가능한 기능만을 제공하는 MCP는 반려 또는 공개 제한될 수 있음.
> 단, LLM 기본 기능을 확장/추가하는 목적이 명확하면 예외.

→ 방어: 이 서버의 모든 도구는 **정보나루 API가 계산해 주는 원본 지표를 가공**한다.
LLM은 이 통계를 모르고, 웹 검색으로도 "혼잡도 백분위", "함께 대출된 책 10권" 같은 값은 안 나온다.

### 2.2 가짜/더미 데이터 금지
> MCP가 제공하는 데이터의 출처가 명확하지 않은 경우 승인이 반려될 수 있으며,
> 운영자는 데이터의 출처 및 구성 확인을 위해 증빙 자료를 요청할 수 있음.

→ **캐싱은 "실제 API 응답을 저장"하는 것이지 "가짜 데이터로 대체"하는 게 아니다.**
회수식품 서버 개발 중 이 둘을 혼동한 잘못된 명세가 나온 적 있다. 절대 반복하지 말 것.
모든 도구는 정보나루 실 API 응답을 기반으로 해야 한다.

### 2.3 생성형 도구 금지 (사실상)
> 심사 기준: "데이터를 어떻게 가공하는지"가 핵심.

페이지÷일수 같은 LLM 암산형 계산은 넣지 않는다. 전부 실측 데이터 기반 계산만 사용한다.

### 2.4 상업 행위 금지
> 답변 내 상업적 링크, 구매 유도, 리워드 제공 등 명시적/암묵적 상업 행위가
> 지나치게 포함될 경우 반려 사유.

→ 쿠폰, 할인 코드, 제휴 유도 문구는 절대 넣지 않는다.
수익 방향성은 도구 구조 자체로 드러나면 충분하다 (지자체 이용 활성화, 출판사 수요 데이터 등).
**자소서에 쓸 문장이지, 도구 출력에 넣을 내용이 아니다.**

### 2.5 동일 기능 반복 등록 금지
> 동일 기능 구조의 MCP가 반복적으로 공개 등록 심사를 요청하는 경우 등록이 제한될 수 있음.
> 단순히 명칭, 문구, 출력 형식만 변경한 MCP는 별도의 신규 MCP로 인정되지 않음.

→ `data4library-mcp`(25개 도구)와 기능이 겹치는 도구는 만들지 않는다.
소장 검색, 단순 대출 가능 여부 조회, GPS 주변 도서관 같은 "그대로 조회"형은 이미 있다.
**이 서버는 반드시 "가공"이 들어가야 한다.** (4장 도구 설계가 그렇게 되어 있음)

### 2.6 개인정보
아래 항목을 요구/응답에 포함하면 반려: 주민등록번호, 운전면허번호, 여권번호, 외국인등록번호, 카드번호, 계좌번호.
이 서버는 도서명·ISBN·지역코드만 다루므로 해당 없음.

---

## 3. 데이터 소스 — 확정된 사실 (실호출로 검증 완료)

**국립중앙도서관 도서관 정보나루 Open API** (`data4library.kr`)

- **인증키 신청 → 발급까지 익일 오전.** 오늘 신청 안 하면 내일도 개발 못 한다.
- **응답 형식은 XML이다.** JSON 아님. `fast-xml-parser` 등으로 파싱.
- 호출 한도: 기본 500회/일. **서버 IP 등록 시 30,000회/일로 상향.** 본선 대중 사용 대비 필수.
- 데이터 공개에 **참여하는 도서관만** 커버한다. 전국 도서관 전체가 아님.

### 3.1 `usageTrend` — 도서관별 대출반납 추이
```
http://data4library.kr/api/usageTrend?authKey=[키]&libCode=[도서관코드]&type=D
```
- `type=D`: 요일별, `type=H`: 시간대별로 추정 (매뉴얼 재확인 권장)
- **미확인:** 실제 응답 XML 구조와 필드명. 개발 착수 전 실호출로 확인 필수.
- **미확인:** 도서관 코드별로 이 데이터가 얼마나 채워져 있는지(참여 도서관 커버리지).
  비어 있는 도서관이 많으면 Tool 1의 유용성이 떨어지므로 반드시 사전 확인.

### 3.2 `bookExist` — 도서관별 도서 소장여부
```
http://data4library.kr/api/bookExist?authKey=[키]&libCode=[도서관코드]&isbn13=[ISBN]
```
- 소장여부 제공 확인됨. **대출 가능 여부까지 주는지는 미확인** — 서드파티(BOOK-TALK/Readables)가
  이 API로 "대출 가능/불가능"을 구현한 사례가 있어 가능성 높으나, 실응답 필드로 직접 확인할 것.

### 3.3 `usageAnalysisList` — 도서별 이용 분석 (Tool 3의 핵심 데이터 소스, 구조 완전 확인됨)
```
http://data4library.kr/api/usageAnalysisList?authKey=[키]&isbn13=[ISBN]
```

**실제 XML 구조 (3개 샘플로 검증 완료):**

```xml
<response>
  <request><isbn13>...</isbn13></request>
  <book>
    <bookname><![CDATA[...]]></bookname>
    <authors><![CDATA[...]]></authors>
    <publisher><![CDATA[...]]></publisher>
    <publication_year><![CDATA[...]]></publication_year>
    <isbn13><![CDATA[...]]></isbn13>
    <addition_symbol><![CDATA[...]]></addition_symbol>
    <vol><![CDATA[...]]></vol>              <!-- 자기닫힘 <vol/> 가능. 단행본은 대부분 비어있음 -->
    <class_no><![CDATA[...]]></class_no>
    <class_nm><![CDATA[...]]></class_nm>     <!-- 예: "문학 > 한국문학 > 소설" -->
    <description><![CDATA[...]]></description>  <!-- 자기닫힘 <description/> 가능 -->
    <bookImageURL><![CDATA[...]]></bookImageURL>
    <loanCnt><![CDATA[...]]></loanCnt>        <!-- 누적 대출 횟수 -->
  </book>
  <loanHistory>
    <loan><month>2025년 07월</month><loanCnt>1920</loanCnt><ranking>74</ranking></loan>
    <!-- 최근 12개월, 반복 -->
  </loanHistory>
  <loanGrps>
    <loanGrp><age>40대</age><gender>여성</gender><loanCnt>375</loanCnt><ranking>80</ranking></loanGrp>
    <!-- age 는 자기닫힘 <age/> (빈 값)로 오는 경우가 있음. 절대 특정 연령으로 단정하지 말 것.
         확인된 값: 유아, 초등, 청소년, 20대, 30대, 40대, 50대, 60대이상, 그리고 빈 값(연령 미상)
         반복 항목, 여러 개 -->
  </loanGrps>
  <keywords>
    <keyword><word><![CDATA[...]]></word><weight><![CDATA[...]]></weight></keyword>
    <!-- 반복, 많으면 50개 이상 -->
  </keywords>
  <coLoanBooks>
    <book>
      <bookname><![CDATA[...]]></bookname>
      <authors><![CDATA[...]]></authors>
      <publisher><![CDATA[...]]></publisher>
      <publication_year><![CDATA[...]]></publication_year>
      <isbn13><![CDATA[...]]></isbn13>
      <vol><![CDATA[...]]></vol>   <!-- 또는 자기닫힘 -->
    </book>
    <!-- 반복, 최대 10권. "함께 대출된 도서" (최근 36개월 동시대출빈도 기준) -->
  </coLoanBooks>
  <maniaRecBooks>
    <!-- coLoanBooks와 동일한 <book> 구조 반복. "마니아 추천도서" -->
  </maniaRecBooks>
  <readerRecBooks>
    <!-- coLoanBooks와 동일한 <book> 구조 반복. "다독자 추천도서" -->
  </readerRecBooks>
</response>
```

**세 추천 목록(`coLoanBooks`/`maniaRecBooks`/`readerRecBooks`)의 실제 성격 — 3개 샘플로 검증:**

| 지표 | 성격 (관찰됨) |
|---|---|
| `coLoanBooks` | 실제 동시 대출 데이터. 폭넓고 다양한 스펙트럼 |
| `maniaRecBooks` | 같은 작가/같은 결의 유사 작품 위주 |
| `readerRecBooks` | 최신 화제작 위주, 트렌드성 강함 |

- **시리즈물(아동서 등)일 경우 세 목록이 거의 동일**하게 나옴 (같은 시리즈 다른 권들로 채워짐).
  샘플: `흔한남매`, `내 멋대로 뽑기` 시리즈 — 세 목록 겹침 큼.
- **일반 단행본(성인 소설 등)일 경우 세 목록이 서로 다름.**
  샘플: `아몬드`(손원평) — coLoanBooks(다양한 동시대 소설), maniaRecBooks(손원평 작가 다른 책+유사 청소년문학),
  readerRecBooks(최신 화제작)가 명확히 갈림.
- **결론: 억지로 시리즈/비시리즈를 분기하지 않는다. 세 지표를 있는 그대로 세 섹션으로 보여주면
  데이터가 알아서 시리즈물이면 겹치고 단행본이면 갈린다.** (4.4절 Tool 3 설계 참조)

**같은 책의 다른 판본이 여러 ISBN으로 중복 등장할 수 있음** (샘플: 위저드 베이커리가 `maniaRecBooks`에
ISBN 두 개로 각각 등장). **완전 병합하지 말고, ISBN 기준으로만 중복 판정.** 같은 책명이라도 ISBN이 다르면
다른 레코드로 취급 (오탐 방지 원칙).

---

## 4. 도구 설계 — 최종 확정 4개

전부 실데이터 기반, 생성형 0개, `data4library-mcp`와 미중복.

### Tool 1: `find_best_visit_time` ★ 이 서버의 존재 이유
- **입력**: `library_code` (도서관 코드, 필수)
- **처리**: `usageTrend` 응답(요일별/시간대별 대출반납 추이)을 받아
  각 요일×시간대의 상대적 혼잡도를 백분위로 계산 → 한산한 시간대 상위 3개 도출
- **왜 가공인가**: 원본 API는 추이 수치만 준다. "언제 가면 한산한가"라는 판단은 없다.
  25개 기존 도구 어디에도 없음.
- **출력**: 요일/시간대별 혼잡도 지표 + 최적 방문 시간 TOP 3 (마크다운)
- **annotations**: `openWorldHint: true` (외부 데이터 조회)
- **주의**: `usageTrend`가 해당 도서관에 데이터가 없을 수 있음(참여 도서관만 커버).
  없으면 "이 도서관은 혼잡도 데이터가 제공되지 않습니다"로 안내, 절대 추측하지 않는다.

### Tool 2: `find_trending_books_and_library_match`
- **입력**: `region`(지역코드), `age_group`(선택), `library_code`(필수)
- **처리**: 인기대출 API로 후보 도출 → 상위 5권으로 압축 → 각 권을 지정 도서관의 `bookExist`와
  병렬 조회(`Promise.all`)하여 소장 여부 확인 → Tool 1의 혼잡도 데이터 결합
- **왜 5권인가**: 원래 검토안은 20권이었으나, 20회 순차 API 호출은 100ms/3000ms 제한을 초과할 위험이
  큼. 5권 + 병렬 처리로 레이턴시를 방어한다.
- **출력**: 즉시 대출 가능한 인기 도서 목록 + 해당 도서관 추천 방문 시간 (마크다운 표)
- **annotations**: `openWorldHint: true`
- **주의**: `bookExist`가 대출 가능 여부까지 안 주면(3.2절 미확인 사항), "소장 여부"까지만 표시하고
  "대출 가능 여부는 도서관에 직접 확인하십시오"를 덧붙인다. 없는 값을 지어내지 않는다.

### Tool 3: `generate_data_driven_reading_roadmap`
- **입력**: `isbn` (필수)
- **처리**: `usageAnalysisList` 1회 호출 → `coLoanBooks`, `maniaRecBooks`, `readerRecBooks`를
  각각 별도 섹션으로 정리. ISBN 기준 중복만 제거(같은 ISBN이 여러 섹션에 나오면 첫 섹션에만 남김).
  **억지로 하나의 "3단계 로드맵"으로 합치지 않는다.** 세 섹션을 있는 그대로 보여준다.
- **출력 형식**:
  ```markdown
  ## 함께 읽힌 책 (coLoanBooks)
  실제 동시 대출 데이터 기반
  - ...

  ## 같은 결의 다음 책 (maniaRecBooks)
  마니아 추천
  - ...

  ## 요즘 다독자들의 다음 선택 (readerRecBooks)
  다독자 추천
  - ...
  ```
- **왜 가공인가**: LLM의 자의적 추천(환각)을 배제하고 정보나루 실측 통계만 사용.
  "이 책을 빌린 사람이 실제로 함께 빌린 책"은 LLM이 모르는 값.
- **범위를 벗어나는 경우**: 해당 ISBN이 `usageAnalysisList`에서 데이터가 없으면
  **가짜 데이터를 지어내지 않고 정중한 에러 메시지 반환** ("이 책은 분석 데이터가 부족합니다").
  이 원칙이 심사정책 2.2절(출처 불명확 데이터 반려)을 정확히 방어한다.
- **annotations**: `openWorldHint: true`

### Tool 4 후보였던 "쿠폰/북카페" — 폐기
> 반려 사유 2.4(상업 행위) 정면 위반. 만들지 않는다.

만약 4번째 도구가 필요하면, `usageAnalysisList`의 `loanGrps`(연령/성별 분포)를 활용해
"이 책을 실제로 많이 빌리는 연령대"를 알려주는 도구를 대안으로 검토할 것 (생성형 아님, 실데이터).

---

## 5. 아키텍처 — 회수식품 서버에서 검증된 패턴 재사용

### 5.1 캐싱 전략
- `usageTrend`, `bookExist`, `usageAnalysisList`는 **파라미터 의존적**(도서관코드/ISBN별로 다름)이라
  회수식품처럼 "전체를 기동 시 한 번에 적재"하는 방식이 안 통한다.
- 대신 **호출 결과를 짧은 TTL로 캐시**한다(예: 1~6시간). 같은 ISBN/도서관코드가 반복 조회되면
  캐시 히트로 100ms를 만족시키고, 미스면 실제 API 호출(정보나루 자체는 100ms를 보장 안 하므로
  이 부분에서 지연이 생길 수 있음 — 실측 필요).
- Tool 1처럼 도서관 수가 유한하면, 전체 도서관 코드 목록에 대해 `usageTrend`를 **주기적으로 미리
  적재**하는 것도 검토(회수식품과 같은 패턴). 참여 도서관 수가 적으면 이 방식이 낫다.

### 5.2 서버 골격 (Node.js/TypeScript, @modelcontextprotocol/sdk)
회수식품 서버와 동일한 구조를 그대로 가져온다:
- `express` + `StreamableHTTPServerTransport({ sessionIdGenerator: undefined })`
- `POST /mcp` 만 구현. `GET/DELETE /mcp`는 405 반환 (stateless 명시)
- `GET /health`: 프로세스 생존만 확인, 항상 200
- `GET /ready`: 캐시/데이터 준비 상태 확인, 미준비 시 503
- **`app.listen()`을 먼저, 캐시/사전 로딩은 그 다음에 백그라운드로.**

### 5.3 XML 파싱 — 배열 방어 필수
XML 파서(`fast-xml-parser` 등)는 자식 요소가 1개면 배열이 아니라 단일 객체로 반환하는 경우가 흔하다.
`coLoanBooks.book`, `maniaRecBooks.book`, `readerRecBooks.book`, `loanGrps.loanGrp`,
`keywords.keyword`, `loanHistory.loan` 전부 아래 헬퍼로 감쌀 것:
```typescript
function ensureArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}
```
0건(빈 요소 자체가 없음), 1건(단일 객체), 다건(배열) 세 경우 모두 테스트할 것.

### 5.4 자기닫힘 태그(빈 값) 처리
`<age/>`, `<vol/>`, `<description/>` 같은 자기닫힘 태그는 파서에 따라 빈 문자열, `null`, 또는
빈 객체로 나올 수 있다. 실제 파서 선택 후 이 케이스를 반드시 테스트할 것.
**빈 `age`를 특정 연령대로 추측하지 말 것.** "연령 미상"으로 표시한다.

### 5.5 24k 응답 가드
회수식품 서버의 `guard()` 함수를 그대로 재사용:
```typescript
const MAX_RESPONSE_CHARS = 20000; // 24k에 대한 안전 마진
function guard(md: string): string {
  if (md.length <= MAX_RESPONSE_CHARS) return md;
  return md.slice(0, MAX_RESPONSE_CHARS - 200) + '\n\n…(응답 크기 제한으로 생략)';
}
```
`keywords`가 50개 이상 나올 수 있으므로(3.3절 샘플 참조), Tool 3에서 키워드를 전부 출력하지 말고
상위 10~15개만 사용할 것.

---

## 6. 제출 전 체크리스트

- [ ] 정보나루 인증키 신청 (발급 익일 오전 — 지금 안 하면 내일도 개발 못 한다)
- [ ] 서버 IP 등록 → 호출한도 500/일 → 30,000/일 상향
- [ ] `usageTrend` 실호출로 응답 구조 확정 (3.1절 미확인 사항 해소)
- [ ] `bookExist`가 대출가능 여부까지 주는지 실호출로 확정 (3.2절)
- [ ] Tool 1~3 전부 구현, `data4library-mcp` 25개 도구와 최종 비교하여 겹치지 않는지 확인
- [ ] 도구 이름에 `kakao` 없음, annotations 5개 전부 지정
- [ ] description 영문 + 서비스명 영·국문 병기, 1024자 이내
- [ ] 응답 TextContent + Markdown, 24k 가드 적용
- [ ] XML 배열/빈값 파싱 방어 (0건/1건/다건 모두 테스트)
- [ ] 서버 기동 순서: 포트 먼저, 캐시/사전로딩 백그라운드
- [ ] 캐시 미준비 시 도구가 예외 아닌 안내 텍스트 반환
- [ ] `npx @modelcontextprotocol/inspector` 통과
- [ ] 캐시 없이도 `tools/list` 성공하는지 로컬 검증 (회수식품에서 썼던 방법: curl로 initialize → tools/list 직접 호출)
- [ ] 카카오 클라우드 배포 → PlayMCP 임시 등록 → "정보 불러오기" 성공
- [ ] 도구함 추가 → AI 채팅에서 4개 도구 전부 실제 호출
- [ ] 심사 요청 (요청 후 도구 변경 시 재심사이므로 그 전에 확정)

---

## 7. 참고 — 일정

- 오늘 7/9. 카카오 예선 심사 요청 마지노선 **7/10 금요일**.
- 회수식품 서버가 이미 배포·등록 병목을 뚫었다면 그 노하우(Dockerfile, 기동 순서, PlayMCP 등록 절차)를
  그대로 재사용할 것 — 처음부터 다시 겪을 필요 없음.
- 인증키 발급이 익일 오전이므로, 신청이 늦어지면 이 일정 자체가 불가능해진다. **최우선 처리.**
