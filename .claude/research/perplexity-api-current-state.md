# Perplexity API — Current State Reference

## 2026-05-31 — Full API surface audit (Dec 2025 → May 2026 delta)

**Shape**: reference lookup

---

## Documentation Sources

| Source | URL |
|---|---|
| Official changelog | https://docs.perplexity.ai/docs/resources/changelog |
| Sonar API reference (`/v1/sonar`) | https://docs.perplexity.ai/api-reference/sonar-post |
| Search API reference (`/search`) | https://docs.perplexity.ai/api-reference/search-post |
| Async Sonar API reference | https://docs.perplexity.ai/api-reference/async-sonar-post |
| Agent API reference | https://docs.perplexity.ai/api-reference/agent-post |
| Sonar models index | https://docs.perplexity.ai/docs/sonar/models |
| Pricing | https://docs.perplexity.ai/docs/getting-started/pricing |
| SDK npm page | https://www.npmjs.com/package/@perplexity-ai/perplexity_ai |
| SDK GitHub changelog | https://github.com/perplexityai/perplexity-node/blob/main/CHANGELOG.md |
| Agent API quickstart | https://docs.perplexity.ai/docs/agent-api/quickstart |
| Agent API OpenAI compatibility | https://docs.perplexity.ai/docs/agent-api/openai-compatibility |
| People Search | https://docs.perplexity.ai/docs/search/filters/people-search |

---

## 1. Sonar API — `/v1/sonar` (Chat Completions)

**Endpoint**: `POST https://api.perplexity.ai/v1/sonar`

Note: this is the **new canonical URL** as of late 2025. The old `/chat/completions` path is now an alias. The SDK still exposes `client.chat.completions.create()` which maps here.

### Full Parameter List (as of 2026-05-31)

#### Required
| Parameter | Type | Notes |
|---|---|---|
| `model` | enum | One of: `sonar`, `sonar-pro`, `sonar-deep-research`, `sonar-reasoning-pro` |
| `messages` | ChatMessage[] | Standard `{role, content}` format |

#### Standard LLM parameters
| Parameter | Type | Default | Notes |
|---|---|---|---|
| `max_tokens` | integer\|null | — | Range: 1–128000 |
| `stream` | boolean\|null | false | SSE streaming |
| `stop` | string\|string[] | — | Stop sequences |
| `temperature` | number\|null | — | Range: 0–2 |
| `top_p` | number\|null | — | Range: 0–1 |

#### Search / web controls (NEW since late 2024–2025)
| Parameter | Type | Notes |
|---|---|---|
| `search_mode` | enum\|null | `web`, `academic`, `sec` — added Jun/Jul 2025 |
| `search_domain_filter` | string[]\|null | Allow-list domains (max 20) |
| `search_language_filter` | string[]\|null | ISO 639-1 codes |
| `search_recency_filter` | enum\|null | `hour`, `day`, `week`, `month`, `year` |
| `search_after_date_filter` | string\|null | Published after date (MM/DD/YYYY) |
| `search_before_date_filter` | string\|null | Published before date (MM/DD/YYYY) |
| `last_updated_after_filter` | string\|null | Last-updated after (MM/DD/YYYY) — added Jun 2025 |
| `last_updated_before_filter` | string\|null | Last-updated before (MM/DD/YYYY) — added Jun 2025 |
| `disable_search` | boolean\|null | When true: no web search, model uses training data only |
| `enable_search_classifier` | boolean\|null | When true: classifier decides if web search is needed (Pro Search feature) |
| `language_preference` | string\|null | ISO 639-1 code for preferred response language |

#### `web_search_options` (nested object)
| Sub-field | Type | Notes |
|---|---|---|
| `search_context_size` | `low`\|`medium`\|`high` | Amount of web content retrieved; drives per-request cost tier |
| `user_location` | object | `{latitude: float, longitude: float, country: string (ISO 3166-1 alpha-2)}` — **all three fields required together** (lat/long without country = validation error) |

**Important**: `search_context_size` is nested under `web_search_options`, not top-level. This is a common integration mistake.

#### Image / media controls (NEW Dec 2025)
| Parameter | Type | Notes |
|---|---|---|
| `return_images` | boolean\|null | Include image results in response (populates `images[]` in response) |
| `return_related_questions` | boolean\|null | Generate follow-up suggestions |
| `image_format_filter` | string[]\|null | Filter by image format e.g. `["png","jpg"]` |
| `image_domain_filter` | string[]\|null | Limit images to specific domains |

#### Structured output / response format
| Parameter | Type | Notes |
|---|---|---|
| `response_format` | ResponseFormatText\|ResponseFormatJSONSchema | Set `type: "json_schema"` for structured output; available to all users since Mar 2025 |

#### Reasoning (NEW May 2025)
| Parameter | Type | Notes |
|---|---|---|
| `reasoning_effort` | enum\|null | `minimal`, `low`, `medium`, `high` — **only meaningful for `sonar-deep-research`**; controls reasoning token budget |

#### Streaming mode (NEW — Pro Search)
| Parameter | Type | Default | Notes |
|---|---|---|---|
| `stream_mode` | enum | `full` | `full`: reasoning suppressed, metadata inline; `concise`: reasoning events emitted separately (Pro Search / sonar-pro) |

### Response Shape Changes
The **`citations` field** (plain URL array) was deprecated in May 2025 and replaced by `search_results[]`, which is richer:

```json
"search_results": [
  {
    "title": "...",
    "url": "...",
    "date": "...",          // publication date
    "last_updated": "...",  // new field
    "snippet": "...",       // new field
    "source": "web"         // new field
  }
]
```

**Warning**: `citations` still appears in the API reference schema as `string[]|null` (for backward compat), but the May 2025 changelog says it is "fully deprecated and removed." In practice the field may still be populated. Trust `search_results` as the primary field.

The `usage` object now includes detailed cost breakdown (added Jul 2025):
```json
"usage": {
  "prompt_tokens": ...,
  "completion_tokens": ...,
  "total_tokens": ...,
  "search_context_size": "medium",
  "cost": {
    "input_tokens_cost": ...,
    "output_tokens_cost": ...,
    "request_cost": ...,
    "reasoning_tokens_cost": ...,
    "citation_tokens_cost": ...,
    "search_queries_cost": ...,
    "total_cost": ...
  },
  "citation_tokens": ...,
  "num_search_queries": ...,
  "reasoning_tokens": ...
}
```

### `search_mode` detail
- `web` — default general web search
- `academic` — prioritizes peer-reviewed papers, journals, research publications (added Jun 2025)
- `sec` — restricts to SEC regulatory filings: 10-K, 10-Q, 8-K, etc. (added Jul 2025)

---

## 2. Search API — `POST https://api.perplexity.ai/search`

**Separate from Sonar API.** Returns raw ranked results — no LLM synthesis. Added Sep 2025. Base URL is `/search`, not `/v1/sonar`.

### Parameters

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `query` | string\|string[] | — | **REQUIRED**. Supports multi-query array (runs multiple searches in one request) |
| `max_results` | integer | 10 | Range: 1–20 |
| `country` | string | — | ISO 3166-1 alpha-2 country code |
| `snippet_mode` | string | `high` | `low`, `medium`, `high` — controls extraction depth; omit when using `max_tokens` or `max_tokens_per_page` |
| `max_tokens` | integer | — | Total tokens across all results; range 1–1,000,000 |
| `max_tokens_per_page` | integer | — | Per-result token cap; range 1–1,000,000 (added Dec 2025) |
| `search_domain_filter` | string[] | — | Domain allow-list (max 20) |
| `search_language_filter` | string[] | — | ISO 639-1 codes (max 20, 2-char max each) |
| `search_recency_filter` | enum | — | `hour`, `day`, `week`, `month`, `year` |
| `search_after_date_filter` | string | — | Published after (MM/DD/YYYY) |
| `search_before_date_filter` | string | — | Published before (MM/DD/YYYY) |
| `last_updated_after_filter` | string | — | Last-updated after (MM/DD/YYYY) (added Dec 2025) |
| `last_updated_before_filter` | string | — | Last-updated before (MM/DD/YYYY) (added Dec 2025) |
| `search_type` | string | — | `"people"` for People Search mode (added May 2026) |

**Note**: `search_mode` (`academic`/`sec`) from the Sonar API does **not** appear in the current Search API spec. The Search API uses `search_type` for routing (currently only `"people"` is documented).

### Response Shape
```json
{
  "id": "...",
  "server_time": "...",
  "results": [
    {
      "title": "...",
      "url": "...",
      "snippet": "...",
      "date": "...",
      "last_updated": "..."
    }
  ]
}
```

---

## 3. Async Sonar API — `/v1/async/sonar`

Added May 2025. Designed specifically for `sonar-deep-research` which can take 30+ seconds.

### Endpoints
| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/async/sonar` | Submit async job |
| `GET` | `/v1/async/sonar` | List all async jobs for authenticated user |
| `GET` | `/v1/async/sonar/{request_id}` | Poll job status and retrieve result |

### Submit Request Body
```json
{
  "request": {
    // Same fields as synchronous /v1/sonar
    "model": "sonar-deep-research",
    "messages": [...]
  },
  "idempotency_key": "optional-string"
}
```

### Job Response Fields
```json
{
  "id": "...",
  "model": "...",
  "status": "CREATED|IN_PROGRESS|COMPLETED|FAILED",
  "created_at": 1234567890,
  "started_at": 1234567890,
  "completed_at": 1234567890,
  "failed_at": null,
  "error_message": null,
  "response": { /* same as synchronous CompletionResponse when COMPLETED */ }
}
```

**TTL**: 7 days. Jobs older than 7 days are no longer accessible.

---

## 4. Agent API — `/v1/agent` (NEW Feb 2026)

Full GA February 2026. This is a **separate API** with an OpenAI Responses-compatible surface.

### Endpoints
| Method | Path | Notes |
|---|---|---|
| `POST` | `/v1/agent` | Canonical Agent API endpoint |
| `POST` | `/v1/responses` | Alias for OpenAI Responses SDK compatibility |
| `GET` | `/v1/models` | List Agent API models (no auth required) — added Apr 2026 |

### Parameters
| Parameter | Type | Notes |
|---|---|---|
| `model` | string | Format: `"provider/model"` e.g. `"openai/gpt-4.1"`, `"anthropic/claude-sonnet-4-6"` |
| `models` | string[] | Fallback chain; takes precedence over `model` |
| `preset` | string | Named preset: `"fast-search"`, `"pro-search"`, `"deep-research"` |
| `input` | string\|array | Prompt or structured message array |
| `instructions` | string | System prompt |
| `max_output_tokens` | integer | Max output tokens |
| `max_steps` | integer | Max agentic reasoning/tool steps (1–10) |
| `stream` | boolean | SSE streaming |
| `language_preference` | string | ISO 639-1 |
| `tools` | array | Built-in: `web_search`, `fetch_url`, `people_search`, `finance_search` (May 2026), `sandbox` (May 2026) |

### Built-in Tools (Agent API)
- `web_search` — multi-step web search in the reasoning loop
- `fetch_url` — fetch content from specific URLs
- `people_search` — professional/people lookup; backed by Search API `search_type="people"`
- `finance_search` — **NEW May 2026** — structured financial data: quotes, financials, earnings, analyst estimates, ETF constituents
- `sandbox` — **NEW May 2026** — secure code execution (Sandbox API, coming soon generally)

### Supported Third-Party Models (Agent API only — not Sonar API)
As of April–May 2026: GPT-5.5, GPT-5.4, Claude Opus 4.7, Claude Sonnet 4.6, Gemini 3.1 Pro Preview, NVIDIA Nemotron, Grok 4.20 Reasoning

### Other New APIs (Feb 2026)
- **Embeddings API** (`POST /v1/embeddings`) — standard and contextualized embeddings
- **Contextualized Embeddings** (`POST /v1/embeddings/contextualized`) — special variant for RAG

---

## 5. Model Lineup (Sonar API — `client.chat.completions.create()`)

### Current Valid Model IDs for `/v1/sonar`

| Model ID | Category | Context Window | Notes |
|---|---|---|---|
| `sonar` | Search | ~128k | Lightweight, cost-effective, grounded |
| `sonar-pro` | Search | **200k** | Advanced, Pro Search support, media classifier |
| `sonar-reasoning-pro` | Reasoning | ~128k (unconfirmed) | Chain-of-thought, multi-step reasoning |
| `sonar-deep-research` | Research | 128k | Exhaustive web research; async recommended; `reasoning_effort` supported |

### Removed Models
- `sonar-reasoning` — **removed Dec 15, 2025** (replaced by `sonar-reasoning-pro`)
- `r1-1776` — **removed Aug 1, 2025** (replaced by `sonar-reasoning-pro`)
- `llama-3.1-sonar-*` — removed Feb 22, 2025

**Migration**: `sonar-reasoning` → `sonar-reasoning-pro`. The CLAUDE.md already has this correct.

### Pricing Summary (Sonar API)

**Sonar Pro** (`sonar-pro`):
- Input: $3.00/1M tokens, Output: $15.00/1M tokens
- Request fee by `search_context_size` and search type:
  - Fast search: low $6/1k req, medium $10/1k req, high $14/1k req
  - Pro search: low $14/1k req, medium $18/1k req, high $22/1k req

**Sonar Reasoning Pro** (`sonar-reasoning-pro`):
- Input: $2.00/1M tokens, Output: $8.00/1M tokens
- Request fee: low $6/1k req, medium $10/1k req, high $14/1k req

**Sonar Deep Research** (`sonar-deep-research`):
- Input: $2.00/1M, Output: $8.00/1M, Citation tokens: $2.00/1M
- Search queries: $5.00/1k queries, Reasoning tokens: $3.00/1M
- No fixed request fee tier; cost is purely additive

**Sonar** (`sonar`):
- Lower cost than sonar-pro; exact figures in pricing page

---

## 6. Official SDK — `@perplexity-ai/perplexity_ai`

**Current version**: `0.31.0` (published 2026-05-30, ~19 hours before this research)

**GitHub**: https://github.com/perplexityai/perplexity-node

Generated by Stainless. 0 external runtime dependencies.

### Methods exposed by the SDK
```typescript
const client = new Perplexity({ apiKey: '...' });

// Sonar (chat completions)
client.chat.completions.create({ model: 'sonar', messages: [...] })

// Search API (raw results)
client.search.create({ query: '...', max_results: 5 })

// Responses (Agent API — OpenAI compat surface)
client.responses.create({ model: 'openai/gpt-4.1', input: '...' })
client.responses.retrieve(id)  // added v0.30.0

// Async Sonar (via raw HTTP helpers or undocumented)
// Not explicitly surfaced as client.async.sonar.* — use client.post('/v1/async/sonar', ...) or the raw API
```

### TypeScript Types
```typescript
Perplexity.Chat.CompletionCreateParams
Perplexity.Search.SearchCreateParams
Perplexity.Search.SearchCreateResponse
Perplexity.ResponseCreateParams
Perplexity.ResponseCreateResponse
Perplexity.StreamChunk
```

### Key SDK Version History (Dec 2025 → May 2026)

| Version | Date | Change |
|---|---|---|
| 0.31.0 | 2026-05-30 | `responses`: add `sandbox` built-in tool |
| 0.30.1 | 2026-05-27 | **Bug fix**: removed premature `search_context_size` from `search.create` (it belongs in Sonar, not Search API) |
| 0.30.0 | 2026-05-27 | Added `search_context_size`, background tasks, `reasoning_effort: "xhigh"`, `responses.retrieve` |
| 0.29.1 | 2026-05-27 | Fix: SSE event yielding for `responses.create`, TS Node 26 compat |
| 0.29.0 | 2026-05-13 | Search: add `search_type` param for People Search routing |
| 0.28.0 | 2026-05-13 | Responses: add `people_search` and `finance_search` built-in tools |
| 0.27.0 | 2026-04-14 | Send `X-Source` and `X-Title` headers |
| 0.26.0 | 2026-02-23 | Add browser and sandbox API endpoints |
| 0.24.0 | 2026-02-12 | Add Embeddings API |
| 0.23.0 | 2026-01-27 | Manual API updates |
| 0.22.0 | 2026-01-24 | `responses.create()` auto-integrates `output_text` |
| 0.18.0 | 2025-12-05 | Manual API updates (sonar-reasoning removal era) |
| 0.16.0 | 2025-11-04 | Add `country` param |
| 0.7.0 | 2025-09-26 | Add `/chat/completions` and `/async/chat/completions` |

**Notable SDK trap (0.30.1)**: `search_context_size` was briefly added to `client.search.create()` in 0.30.0 then immediately removed in 0.30.1 — it is NOT a valid Search API parameter. It belongs only in `web_search_options.search_context_size` on the Sonar API.

### SDK Behavior Notes
- Default timeout: **15 minutes** (appropriate for `sonar-deep-research`)
- Auto-retries: 2 times (connection errors, 408, 409, 429, 5xx)
- Streaming: `for await (const chunk of stream)` pattern
- Node.js 20 LTS+ required; Bun 1.0+, Deno v1.28+, Cloudflare Workers supported

---

## 7. Key Changes Since Late 2025 — Actionable Delta for This Wrapper

### Changes your wrapper needs to handle

**HIGH PRIORITY — API surface gaps:**

1. **`search_mode`** (`web`/`academic`/`sec`) — top-level parameter on Sonar API. Your current tool exposes this as a parameter to `search` and `raw_search`, but the CLAUDE.md says "search_mode" is supported. Verify the handler passes it at top-level (not inside `web_search_options`).

2. **`last_updated_after_filter` / `last_updated_before_filter`** — new date filter pair added Jun 2025 for Sonar API and Dec 2025 for Search API. Not in the original wrapper design.

3. **`disable_search`** — lets Sonar models respond from training data only. Not exposed in current MCP tools.

4. **`enable_search_classifier`** — Pro Search classifier for `sonar-pro`. Not exposed.

5. **`stream_mode`** (`full`/`concise`) — controls streaming event format for Pro Search. Not exposed.

6. **`language_preference`** — ISO 639-1 response language preference. Not exposed.

7. **`return_images`** / `return_related_questions` / `image_format_filter` / `image_domain_filter` — image/media controls. Not exposed.

8. **`reasoning_effort`** now has 4 values: `minimal`, `low`, `medium`, `high` (your CLAUDE.md has 3). The `xhigh` value appears in SDK 0.30.0 changelog but is not in the official API reference schema — likely unreleased/internal; do not expose.

9. **`search_type`** on Search API (`"people"`) — new parameter for People Search routing.

10. **`snippet_mode`** on Search API — `low`/`medium`/`high` content extraction depth. Not in current `raw_search` handler.

11. **`max_tokens` / `max_tokens_per_page`** on Search API — token budget controls. Verify current `raw_search` handler includes these.

**MEDIUM PRIORITY — response field changes:**

12. **`search_results[]` vs `citations[]`** — `citations` is deprecated. If your wrapper surfaces `citations`, it should prefer `search_results` which includes `title`, `url`, `date`, `last_updated`, `snippet`, `source`.

13. **`usage.cost`** detailed breakdown — new as of Jul 2025. Can be surfaced for cost tracking.

14. **`images[]`** in response — populated when `return_images: true`.

15. **`related_questions[]`** in response — populated when `return_related_questions: true`.

**LOW PRIORITY — new endpoints (out of scope for this Sonar wrapper):**

16. **Async Sonar API** (`/v1/async/sonar`) — fire-and-poll pattern for deep research. Could be a new tool.

17. **Agent API** (`/v1/agent`) — fully separate product, different model set, different auth/request shape.

18. **Embeddings API** — separate product.

19. **`GET /v1/models`** — dynamic model listing (no auth required).

### No changes needed
- `sonar-reasoning-pro` model ID — already correct in CLAUDE.md
- `sonar-deep-research`, `sonar-pro`, `sonar` — all still valid
- `web_search_options.search_context_size` placement — already correct in CLAUDE.md
- SDK method `client.chat.completions.create()` — still the right call

---

## 8. Conflict Notes

1. **`citations` field**: The changelog says "fully deprecated and removed" but the `/api-reference/sonar-post` response schema still lists `citations: string[]|null`. Both are authoritative sources — the API likely still returns the field for backward compat even though it's officially deprecated. Trust `search_results` and treat `citations` as an unreliable bonus.

2. **`reasoning_effort` scope**: Docs say it's "only meaningful for `sonar-deep-research`", but the parameter is accepted by all Sonar models (it just has no effect on others). The API schema lists it as a top-level param with no model restriction. Safe to send it unconditionally; just note it only changes behavior for `sonar-deep-research`.

3. **`search_context_size` in Search API**: SDK 0.30.0 added it; 0.30.1 removed it. The current API reference for `/search` does NOT include it. Do not send `search_context_size` to the Search API endpoint.

4. **Search API `search_mode`**: The Sonar API has `search_mode: "web"|"academic"|"sec"`. The Search API (`/search`) does NOT have a `search_mode` parameter — it has `search_type: "people"`. These are different parameters on different endpoints. The current MCP wrapper's `raw_search` tool exposes `search_mode` — verify this is being passed correctly if it routes to Sonar or handled gracefully if it routes to the Search API.
