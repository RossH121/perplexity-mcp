# Perplexity Sonar / Search / Async API Delta: 2026-08-24 → 2026-11-12

## 2026-11-12: Sonar Chat Completions, Search API, and async Sonar changes, with a gap analysis for `search`, `raw_search`, `async_research`

**Shape**: engineering plan (gap analysis)

This is a delta on [`perplexity-api-delta-2026-08.md`](./perplexity-api-delta-2026-08.md) and [`perplexity-api-current-state.md`](./perplexity-api-current-state.md). It does not repeat what those files already got right. It covers only Agent-API facts that matter to these three tools. Agent API, embeddings, and the MCP SDK are out of scope here.

**Codebase snapshot**: SDK `^0.38.3`, with `0.38.3` installed in `node_modules`. Read directly: `src/schemas/toolSchemas.ts`, `src/schemas/validation.ts`, `src/services/PerplexityApiService.ts`, `src/config/constants.ts`, `src/services/ModelSelectionService.ts`.

---

## Headline: Sonar Chat Completions reached end of support on 2026-09-27

The August note said "no deprecation timeline, no sunset date". That is no longer true. The migration overview now carries this banner (verbatim, scraped live 2026-11-12):

> "Sonar Chat Completions support ended on September 27, 2026. Synchronous and streaming requests keep working: they are being reformulated as Agent API requests, rolling out gradually by model. Asynchronous Sonar requests are not reformulated and are no longer supported; move them to background mode."

Corroboration (all independent of the banner):
- The AG2 integration page says "Sonar's async endpoints will be discontinued on September 27, 2026."
- The Community Showcase page says Sonar projects "were removed from this section when Sonar support ended on September 27, 2026."
- The benchmarks page description says "Sonar is retired and has migrated to the Agent API."
- An official Perplexity community announcement (2026-08-13) says "Sonar endpoints ... retire on September 27". Staff confirmed on 2026-09-10: "The Sonar chat completions endpoint will retire on September 27."
- Third-party integrations migrated because of it: symfony/ai PR #2628 (2026-09-30) and Vercel AI SDK provider v5 ("staying on version 4 does not preserve service after the Sonar shutdown").
- The old Sonar docs moved under `/docs/legacy/sonar/*` ("Legacy, Superseded by Agent API"). `/api-reference/sonar-post` now serves the migration overview, not a parameter reference. The pricing page no longer lists Sonar models or Sonar request fees.

**Doc gap**: the official changelog has **no entry** for the 2026-09-27 retirement. The only related entry is still the July 2026 "Sonar Chat Completions migration" item. Don't rely on the changelog alone to track this surface.

### Empirical state today (tier 1 evidence, live calls through this server on 2026-11-12)

| Probe | Result |
|---|---|
| `search`, model `sonar`, `search_mode: "academic"` | Works. The answer is correct, the sources include academic papers (semanticscholar, scienceopen, kluwerlawonline), so `search_mode` still has an effect, and `usage.cost` is present ($0.00409) |
| `search`, model `sonar-pro`, `return_images` + `return_related_questions` | Works. Related questions came back, but no images were returned. One probe is not enough to tell whether reformulation is dropping images |
| `search`, model `sonar-reasoning-pro` | Works. It returned no sources and cost $0.0005, so the request may have skipped search or been reformulated. Inconclusive |
| `async_research submit`, model `sonar` | **400** `{"message":"Async processing is only available for sonar-deep-research","type":"invalid_model"}` |
| `async_research submit`, model `sonar-deep-research`, `reasoning_effort: minimal` | Accepted, then `COMPLETED` with a correct answer. **The async endpoint still works even though the docs call it "no longer supported."** |
| `async_research list` | Works (returned an empty list) |
| `raw_search` with `search_context_size: "low"` | Accepted with no error. Whether it has any effect is unverified (see R3) |

**How to read this**: everything still works today, but it is on borrowed time. Async is officially unsupported and could stop at any moment with no changelog notice. Sync Sonar is being moved onto the Agent API per model. Sonar-only features that have no Agent API equivalent may then stop working silently, with no error. This is the same class of silent-failure bug CLAUDE.md already warns about.

---

## Recommended plan

Ordered by risk. Steps 1–3 are cheap and safe, so ship them now. Step 4 is the strategic migration. Step 5 is housekeeping.

### Step 1 (fix, S): restrict `async_research` `model` to `sonar-deep-research`
`toolSchemas.ts:289-293` sets `enum: VALID_MODELS`, and `validation.ts:118` accepts any `VALID_MODELS`. The API rejects every other model with a 400 (verified above). Change the enum to `["sonar-deep-research"]`, or drop the param and hard-code the model. Not breaking: those inputs already failed.

### Step 2 (deprecation, S, do now): flag `async_research` as deprecated in the tool description
Add a line like this: "Perplexity ended support for async Sonar on 2026-09-27. This tool may stop working without notice. Prefer `agent` with `background:true` + `agent_retrieve`." Also update the `CLAUDE.md` tool entry. The `agent` + `agent_retrieve` + `agent_cancel` stack already covers this use case, since background mode is the documented replacement.

### Step 3 (features, S): Search API additions on `raw_search`
- **`search_type: "fast"`**: add it to the enum at `toolSchemas.ts:226-230` and `validation.ts:100`. It is a lower-latency path that costs $1.00 per 1K requests vs $5.00 for `web`, with the same response shape. Sources: changelog (Sep 2026), `/docs/search/fast-search`, `/api-reference/search-post` (enum `web|fast|people`), the pricing page, and SDK 0.41.0 types. **Verified (4 sources).** Typed in the SDK from 0.38.6 onward. Our `as Function` cast makes that irrelevant at runtime, but bump anyway (Step 5).
- **`max_results` up to 50 for `search_type: "people"`**: `validation.ts:96` hard-caps at 20. The reference says "Min 1, max 50. Values above 20 require search_type=people", and the Fast Search page agrees. Make the cap conditional: 50 when `search_type === "people"`, otherwise 20. Update the schema description too. **Verified (2 sources).**
- **Multi-query limit**: the quickstart says "Pass up to five related queries in one request" and "rate limiting counts each query in the array". Add a client-side cap of 5 and a note in the description. **Single-sourced**, so check it live before enforcing a hard reject.

### Step 4 (deprecation / strategic, L, **breaking for callers if done naively**): move `search` (and the async replacement) onto the Agent API
Nothing forces this today because sync requests still work. But "being reformulated ... gradually by model" means behaviour can change underneath us, one model at a time. Two options:

- **(a) Recommended: re-implement `search` on `client.responses.create`** while keeping the tool's name and output format. Translate the Sonar-style args per the official how-to mapping:
  - **Model → effort** (official how-to, verbatim): "`sonar` → `fast`, `sonar-pro` → `fast`, `sonar-reasoning-pro` → `low`, ... `sonar-deep-research` → `high`." The SDK now names this field `effort`; `preset` is a deprecated alias since SDK 0.41.0 and the Oct 2026 changelog. Coordinate with the Agent-API researcher.
  - **Filters** go to the `web_search` tool's `filters`: `search_domain_filter`, `search_recency_filter`, date and last-updated filters.
  - `user_location` goes to the `web_search` tool. `reasoning_effort` goes to `reasoning.effort`. `max_tokens` becomes `max_output_tokens`. `response_format` keeps the same shape.
  - `search_context_size` has **no named-size equivalent** in the official how-to: "Set explicit token budgets (`max_tokens`, `max_tokens_per_page`) on the `web_search` tool". The Vercel AI SDK says `tools[].search_context_size` instead. That conflicts with the official doc, so treat it as ambiguous and verify live.
  - `return_images` goes to the `image_search` tool. `return_related_questions` needs prompting or structured output.
  - `search_mode`: `academic` has no direct equivalent (use domain filters plus prompting). `sec` goes to `finance_search` or SEC-filtered `web_search`.
  - `disable_search`: omit `web_search`. Effort levels keep their tools, so `max_tool_calls: 0` is the blunt workaround.
  - **No equivalent, drop these**: `search_language_filter`, `stream_mode`, `image_results_enhanced_relevance`, and `search_type: "auto"`. Official how-to: `"pro"` → `effort: "low"`.
  - Output: `choices[0].message.content` becomes `output_text`. Sources come from the `search_results` output item, and images from `image_search_results`.
  - The keyword selector in `ModelSelectionService` and `constants.ts` can stay as-is by mapping its four outputs through the table above.
- **(b) Minimum**: keep `/v1/sonar` and add a canary to `scripts/validate-params.mjs` (Step 5). Each param in the "no equivalent" list gets a probe that checks it still has an effect, so we notice when reformulation reaches a model.

Then rebuild `async_research` on `background: true` with effort `high`, or retire it in favour of `agent`. **Breaking** if `async_research`'s `request_id` semantics or output format change. Keep the tool name and make `status` call `responses.retrieve`.

### Step 5 (housekeeping, S)
- **SDK bump 0.38.3 → 0.41.0.** Releases in between: 0.38.4–0.38.8 (generated syncs, Aug 31 – Oct 7), 0.39.0 (Oct 15: Agent model catalog, Decisions API, custom Skill management, Agent cache controls), 0.39.1, 0.40.0 (Oct 22: batches/files resources, base-URL query-param fix), 0.41.0 (Oct 22: "add effort to Responses, deprecate preset"). **Nothing changed for Sonar chat or async types.** In 0.41.0 the chat `model` is still a free `string`, `reasoning_effort` is still `minimal|low|medium|high`, and `web_search_options` is still `{search_context_size, search_type: fast|pro|auto, user_location, image_results_enhanced_relevance}`. The only Search change is `search_type` gaining `"fast"`. No breaking change for our three tools.
- **The SDK types are wrong again.** The 0.41.0 Search request type still lists `search_mode?: "web"|"academic"|"sec"` (which the API rejects, verified 2026-08-24) and `search_context_size` (which the API reference no longer lists). Keep relying on `validate-params.mjs`.
- **validate-params.mjs additions**: `raw_search` with `search_type:"fast"`; people search with `max_results: 50`; async with model `sonar` (expect a 400); async deep-research submit (canary for when it gets switched off, costs about a cent at `minimal`); one Sonar probe per model for reformulation markers (missing `images`, `related_questions`, or `usage.cost`; `search_mode: academic` no longer changing sources).
- **Doc links**: Sonar pages now live under `/docs/legacy/sonar/`, and `/api-reference/sonar-post` no longer documents Sonar parameters. Update any README/CLAUDE.md pointers.

---

## Gap analysis table

| # | Tool | Item | Status | Evidence tier |
|---|---|---|---|---|
| R1 | `raw_search` | `search_type: "fast"` | New (Sep 2026) | Official reference + guide + pricing + changelog + SDK |
| R2 | `raw_search` | `max_results` 21–50 when `search_type: "people"` | New (date unclear, after Aug 24) | Official reference + Fast Search guide |
| R3 | `raw_search` | `search_context_size` | **Gone from docs**. It was in the reference on 2026-08-24, and now neither the reference nor the quickstart lists it. The quickstart points to `max_tokens`/`max_tokens_per_page`. The API accepts it without a 400; any effect is unverified | Docs vs live call vs SDK types conflict, so ambiguous |
| R4 | `raw_search` | Multi-query capped at 5, each query counts against the rate limit | Newly documented | Quickstart only (single source) |
| R5 | `raw_search` | `search_mode` | Still rejected by the API but still in the SDK types | Prior live call + SDK |
| A1 | `async_research` | Only `sonar-deep-research` accepted | Bug in our schema | Live 400 |
| A2 | `async_research` | Async Sonar "no longer supported" since 2026-09-27 | Deprecated in docs but still works live | Migration overview + AG2 page; live COMPLETED |
| S1 | `search` | Sonar end of support 2026-09-27; sync requests reformulated onto the Agent API per model | Deprecation in progress | 5+ sources (see above) |
| S2 | `search` | Params with no Agent equivalent (`search_language_filter`, `stream_mode`, `image_results_enhanced_relevance`, `search_type:auto`, `search_mode:academic`) | At risk of becoming silent no-ops | Official how-to + Vercel AI SDK + symfony |
| S3 | `search` / `model_info` | All four Sonar IDs still accepted (`sonar`, `sonar-pro`, `sonar-reasoning-pro`, `sonar-deep-research`). No new Sonar models. The Agent API lists one Sonar ID, `perplexity/sonar` ($0.25 in / $2.50 out per 1M) | Keyword selection still maps to valid models | Live calls + Agent Models page |
| S4 | `search` | Sonar pricing removed from the pricing page | Docs | Pricing page |

---

## Conflicts resolved

1. **Model → effort mapping**: the official how-to says `sonar-pro → fast` and `sonar-reasoning-pro → low`. The Vercel AI SDK says `sonar-pro → low` and `sonar-reasoning-pro → medium`, matching the old August mapping. symfony/ai agrees with the official page. **Use the official how-to** (tier 3, newest). The AI SDK table probably copied the older mapping.
2. **Async "no longer supported" vs a live COMPLETED job**: both are true. The endpoint is unsupported, not removed. Treat it as liable to stop without notice.
3. **`search_context_size` on `/search`**: the August reference listed it; the November reference and quickstart don't; the SDK 0.41.0 types still have it; the live API accepts it. Treat it as **deprecated / possibly ignored** until a live A/B test (same query, `low` vs `high`, compare snippet length) shows otherwise.
4. **Changelog vs migration banner**: the changelog has no retirement entry. The banner, community posts, and integration pages all agree on 2026-09-27, so the banner wins.

---

## Documentation Sources

| Source | URL |
|---|---|
| Migration overview (retirement banner) | https://docs.perplexity.ai/docs/agent-api/migrate-from-sonar/overview |
| How to migrate (param + model mapping) | https://docs.perplexity.ai/docs/agent-api/migrate-from-sonar/how-to |
| Benchmarks ("Sonar is retired") | https://docs.perplexity.ai/docs/agent-api/migrate-from-sonar/benchmarks |
| AG2 integration (async discontinued 9/27) | https://docs.perplexity.ai/docs/getting-started/integrations/ag2 |
| Community Showcase (Sonar projects removed) | https://docs.perplexity.ai/docs/cookbook/showcase |
| Legacy Sonar filters page | https://docs.perplexity.ai/docs/legacy/sonar/filters |
| Changelog | https://docs.perplexity.ai/docs/resources/changelog |
| Search API reference | https://docs.perplexity.ai/api-reference/search-post |
| Fast Search guide | https://docs.perplexity.ai/docs/search/fast-search |
| Search quickstart | https://docs.perplexity.ai/docs/search/quickstart |
| Pricing | https://docs.perplexity.ai/docs/getting-started/pricing |
| Agent API models (`perplexity/sonar`) | https://docs.perplexity.ai/docs/agent-api/models |
| Background mode (async replacement) | https://docs.perplexity.ai/docs/agent-api/background-mode |
| Community announcement | https://community.perplexity.ai/t/sonar-is-moving-to-the-agent-api/5802 |
| Community staff confirmation | https://community.perplexity.ai/t/sonar-moving-to-agents-api/6061 |
| symfony/ai migration PR | https://github.com/symfony/ai/pull/2628 |
| Vercel AI SDK Perplexity provider v5 | https://ai-sdk.dev/providers/ai-sdk-providers/perplexity |
| SDK CHANGELOG | https://raw.githubusercontent.com/perplexityai/perplexity-node/main/CHANGELOG.md |
| SDK 0.41.0 generated types | https://unpkg.com/@perplexity-ai/perplexity_ai@0.41.0/dist/generated/api.d.ts |

## Project-specific adaptations

- `src/schemas/toolSchemas.ts`: `raw_search.search_type` enum (+`fast`), `max_results` description (50 for people), `search_context_size` description (deprecated note), `query` description (max 5). `async_research.model` enum becomes `["sonar-deep-research"]`, and its description gets a deprecation note. `search` description gets a note that it rides on a retired API.
- `src/schemas/validation.ts:96,100,118`: conditional `max_results` cap, the `search_type` list, and the async model check.
- `src/schemas/types.ts:178`: `search_type?: "web" | "fast" | "people"`.
- `scripts/validate-params.mjs`: the canaries listed in Step 5.
- `CLAUDE.md`: update the "Valid Sonar models" and `async_research` lines with the 2026-09-27 status. Update the `raw_search` line that currently advertises `search_context_size`.
- **Do not change yet**: the `search_mode` passthrough on `search`. It still has a live effect today.
