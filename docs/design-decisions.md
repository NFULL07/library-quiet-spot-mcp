# Design Decisions

This note summarizes the public, portfolio-friendly design decisions behind LibraryQuietSpot MCP.

## 1. Build Above Raw Lookup APIs

The goal is not to mirror Data4Library endpoints one-to-one. A direct wrapper would add little value because users would still need to interpret raw fields themselves.

Instead, each tool performs a small judgment-oriented transformation:

- `find_best_visit_time` turns usage trend values into relative quiet-time candidates.
- `find_trending_books_and_library_match` combines popular-book data with a selected library ownership check.
- `generate_data_driven_reading_roadmap` separates co-loan, mania, and reader recommendation lists into distinct reading paths.

## 2. Avoid Generated Recommendations

The reading roadmap intentionally does not invent new book recommendations. It only uses recommendation groups returned by Data4Library's `usageAnalysisList`.

This keeps the server explainable: every recommendation can be traced back to public library usage data.

## 3. Prefer Small, Focused Tool Count

The server exposes three tools because tool selection quality matters in conversational MCP use. Each tool answers a different user intent:

- visit planning
- popular book availability
- follow-up reading

Adding many narrow lookup tools would make the system harder for a model to choose from and would duplicate existing API surfaces.

## 4. Defensive XML Parsing

Data4Library responses are XML. XML parsers often return:

- no field for zero items
- a single object for one item
- an array for multiple items

The implementation normalizes all repeated fields through `ensureArray` and treats self-closing tags as empty values instead of guessing missing data.

## 5. Startup Must Be Independent From External Data

The server should expose MCP metadata even when:

- no API key is configured yet
- upstream APIs are temporarily unavailable
- cache is empty

For that reason, `/health` checks only process liveness, while `/ready` reports whether live-data prerequisites are configured.

## 6. Public Repository Hygiene

The repository is structured for public review:

- API keys are provided only through environment variables.
- `.env` and `.env.*` are ignored.
- `.env.example` uses placeholder values.
- README focuses on product, architecture, and validation rather than private development notes.
