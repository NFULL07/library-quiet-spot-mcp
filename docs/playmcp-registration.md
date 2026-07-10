# PlayMCP Registration Draft

## MCP 이름

```text
도서관 책길잡이
```

## MCP 식별자

```text
LibGuide
```

## MCP 설명

```text
도서관 정보나루와 카카오 Local API를 활용해 장소명이나 현재 위치 주변 도서관을 찾고, 읽고 싶은 책을 빌리러 특정 도서관에 가도 되는지, 간 김에 같이 빌릴 다음 책은 무엇인지, 언제 방문 계획을 잡으면 좋은지 한 번에 정리하는 MCP입니다. 자녀의 나이·학년·관심사 기반 추천은 정보나루 연령대별 대출 데이터에 알라딘 서점 메타데이터를 보조 근거로 더해 제공합니다.
```

## 대화 예시

```text
초등학교 3학년 아이 책 추천해줘
```

```text
부산 서면역 근처 도서관 찾아줘
```

```text
마포중앙도서관에 아몬드 빌리러 가도 될까?
```

## 인증 방식

```text
인증 사용하지 않음
```

## Git Source Build

```text
Git URL: https://github.com/NFULL07/library-quiet-spot-mcp.git
Branch: main
Dockerfile path: Dockerfile
Container port: 3000
Secret: DATA4LIBRARY_AUTH_KEY
Secret: KAKAO_REST_API_KEY
Secret: ALADIN_TTB_KEY
```
