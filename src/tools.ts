import { Data4LibraryClient, MissingAuthKeyError, MissingKakaoRestApiKeyError } from "./data4library.js";
import { createRequestContext, RequestContext, runWithRequestContext } from "./request-context.js";
import { guardMarkdown } from "./text.js";
import { recommendBooksForChild } from "./services/child-recommendation.js";
import { findBestVisitTime, findNearbyLibraries, findTrendingBooksAndLibraryMatch, generateReadingRoadmap, planLibraryReadingVisit } from "./services/library-visit.js";
import { normalizeLookupText } from "./services/resolvers.js";
export { TOOL_DEFINITIONS } from "./tools/definitions.js";
export type { ToolDefinition } from "./tools/definitions.js";

export async function callTool(
  client: Data4LibraryClient,
  name: string,
  args: Record<string, unknown>,
  context: RequestContext = createRequestContext()
): Promise<string> {
  return runWithRequestContext(context, async () => {
    try {
      let markdown: string;
      switch (name) {
      case "recommend_books_for_child":
        markdown = await recommendBooksForChild(
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
        );
        break;
      case "find_nearby_libraries":
        markdown = await findNearbyLibraries(
            client,
            optionalString(args, "place_name"),
            optionalNumber(args, "latitude"),
            optionalNumber(args, "longitude"),
            optionalNumber(args, "radius_km"),
            optionalNumber(args, "limit")
        );
        break;
      case "plan_library_reading_visit":
        markdown = await planLibraryReadingVisit(
            client,
            optionalString(args, "library_name"),
            optionalString(args, "library_code"),
            optionalString(args, "book_title"),
            optionalString(args, "isbn")
        );
        break;
      case "find_best_visit_time":
        markdown = await findBestVisitTime(
            client,
            optionalString(args, "library_name"),
            optionalString(args, "library_code")
        );
        break;
      case "find_trending_books_and_library_match":
        markdown = await findTrendingBooksAndLibraryMatch(
            client,
            optionalString(args, "region"),
            optionalString(args, "age_group"),
            optionalString(args, "library_name"),
            optionalString(args, "library_code")
        );
        break;
      case "generate_data_driven_reading_roadmap":
        markdown = await generateReadingRoadmap(
            client,
            optionalString(args, "book_title"),
            optionalString(args, "isbn")
        );
        break;
        default:
          return `알 수 없는 도구입니다: \`${name}\``;
      }
      return guardMarkdown(appendStaleNotices(markdown, context.staleNotices));
    } catch (error) {
      return guardMarkdown(appendStaleNotices(formatToolError(error), context.staleNotices));
    }
  });
}

function appendStaleNotices(markdown: string, notices: string[]): string {
  if (notices.length === 0) return markdown;
  const uniqueNotices = [...new Set(notices)];
  return [
    markdown,
    "",
    "## 데이터 기준 안내",
    "",
    ...uniqueNotices.map((notice) => `- ${notice}`),
    "- 위 항목은 실시간 정보나루 응답이 아니라 서버에 남아 있던 마지막 정상 응답 기준입니다."
  ].join("\n");
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
