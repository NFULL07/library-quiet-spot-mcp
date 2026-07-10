export const MAX_RESPONSE_CHARS = 20000;

export function guardMarkdown(markdown: string): string {
  if (markdown.length <= MAX_RESPONSE_CHARS) return markdown;
  return `${markdown.slice(0, MAX_RESPONSE_CHARS - 200)}\n\n...(응답 크기 제한으로 생략)`;
}

export function cleanText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object" && Object.keys(value).length === 0) return "";
  return String(value).trim();
}

export function ensureArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

export function numberFrom(value: unknown): number | undefined {
  const text = cleanText(value).replace(/,/g, "");
  if (!text) return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function markdownTable(headers: string[], rows: string[][]): string {
  if (rows.length === 0) return "";
  const header = `| ${headers.join(" |")} |`;
  const divider = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.map(escapeCell).join(" | ")} |`);
  return [header, divider, ...body].join("\n");
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}
