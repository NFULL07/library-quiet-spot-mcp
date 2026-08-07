import { BookSummary, Data4LibraryClient, LibrarySummary } from "../data4library.js";
import { markdownTable } from "../text.js";

type LibraryResolution =
  | { kind: "library"; library: LibrarySummary }
  | { kind: "message"; markdown: string };

export async function resolveSingleLibrary(
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

export function selectBestLibraryMatch(query: string, libraries: LibrarySummary[]): LibrarySummary | undefined {
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

export function normalizeLookupText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[()（）\[\]{}·.,_-]/g, "");
}

type BookResolution =
  | { kind: "book"; book: BookSummary }
  | { kind: "message"; markdown: string };

export async function resolveSingleBook(
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

export function normalizeBookBaseTitle(title: string): string {
  const withoutSubtitle = title.split(/[:：]/)[0] ?? title;
  return normalizeLookupText(withoutSubtitle);
}

export function normalizeAuthorKey(authors: string): string {
  return normalizeLookupText(authors)
    .replace(/지음|저자|글|옮김|번역|장편소설|소설/g, "")
    .slice(0, 30);
}
