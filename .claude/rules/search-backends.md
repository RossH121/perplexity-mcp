---
paths:
  - "src/handlers/SearchHandler.ts"
  - "src/handlers/RawSearchHandler.ts"
  - "src/handlers/AsyncResearchHandler.ts"
  - "src/services/agentSearchRequest.ts"
  - "src/services/ModelSelectionService.ts"
  - "src/services/PerplexityApiService.ts"
  - "src/utils/responseFormatting.ts"
  - "src/config/constants.ts"
---

# Search backends (`search`, `raw_search`, `async_research_*`)

## Sonar end of support
- Sonar Chat Completions reached end of support on 2026-09-27 (`docs.perplexity.ai/docs/agent-api/migrate-from-sonar/overview`; the param and model mapping is on `.../how-to`). Perplexity is moving sync Sonar requests onto the Agent API one model at a time, so the legacy backend can change underneath us. Async Sonar is "no longer supported" but still answered on 2026-11-12. The changelog has no entry for the retirement. The old reference is under `docs.perplexity.ai/docs/legacy/sonar/`
- `PERPLEXITY_SEARCH_BACKEND` is read per call (`resolveSearchBackend()`). `agent` is the default; `sonar` exists only for rollback. `validate-params.mjs` has legacy canaries that print LOST when a Sonar-only feature stops working; on 2026-11-12 only images were LOST. Retire the legacy path once the rest go LOST too
- Comparison on 2026-11-12 (6 queries, both backends): the same sources, comparable answers and latency, and the agent backend 2-3x cheaper. The legacy backend returned 0 images where `image_search` returned 5. Academic mode is weaker on the agent backend: it's a domain allowlist (`ACADEMIC_DOMAINS`), about half the sources

## Agent backend mapping (`buildAgentSearchRequest`)
- Model → effort (`SONAR_TO_AGENT_EFFORT`, from the official how-to): `sonar`/`sonar-pro` → `fast`, `sonar-reasoning-pro` → `low`, `sonar-deep-research` → `high`. Keyword routing still picks the Sonar model first. Per-call `effort` bypasses routing; a `set_model` pin is overridden when another model scores ≥ 2
- `return_images` maps to the `image_search` tool, `search_mode:"sec"` to `finance_search` + `sec.gov`, `max_tokens` to `max_output_tokens`
- These are dropped, each with a "Backend notes" line: `search_language_filter`, `stream_mode`, `image_results_enhanced_relevance`, `return_related_questions`, `search_type:"auto"`, `enable_search_classifier`, and `stop`, which the Agent API rejects with a 400
- An effort level always searches first, even with `tools: []`, `tool_choice:"none"` or `max_tool_calls: 0` (2026-11-12). That's why `disable_search` calls the `perplexity/sonar` model directly with no tools
- When explicit published-date filters meet a recency filter, the builder drops recency with a note, because the API returns 400 on that combination
- `SearchHandler` is one long-lived instance. It reads the model and filter state synchronously before its first `await`, so parallel `set_model` or filter calls can't mix into an in-flight call. Keep that ordering if you edit it

## Legacy Sonar backend
- `search_context_size`, `search_type`, `user_location` and `image_results_enhanced_relevance` nest under `web_search_options`, not top-level
- `reasoning_effort` only matters for `sonar-deep-research` there
- The async endpoint returns 400 for any model except `sonar-deep-research`, and the handler rejects them client-side

## `raw_search` (`/search`)
- Never send `search_mode`: `/search` returns `400 "search_mode is not supported"` (2026-08-24), even though the SDK types list it. `validate-params.mjs` fails if the API starts accepting it
- Limits checked live on 2026-11-12: at most 5 queries per request; `max_results` 1-20, or up to 50 with `search_type:"people"`. `search_context_size` is gone from the reference but still changes how much snippet text comes back; a check fails if that stops
