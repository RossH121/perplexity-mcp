# Perplexity API Delta: 2026-05-31 → 2026-08-24

## 2026-08-24: Changelog/SDK delta and gap analysis for MCP server update

**Shape**: engineering plan

This note is a delta against [`perplexity-api-current-state.md`](./perplexity-api-current-state.md) (audited 2026-05-31). Read that file first, this one does not repeat facts it already got right. It also builds on [`agent-tool-default-model-mcp-schema-design.md`](./agent-tool-default-model-mcp-schema-design.md) for the `agent` tool's schema-design precedent (flat enums over root-level `oneOf`/`anyOf`, server-side defaults over hard validation).

**Codebase snapshot at time of writing**: SDK pinned `^0.31.0` in `package.json`, and `node_modules` has literally `0.31.0` installed (semver never re-resolved to a newer patch/minor, the lockfile has been sitting still). Current tool set: `search`, `raw_search`, `async_research`, `agent`, `agent_retrieve`, `embeddings`, `domain_filter`, `recency_filter`, `clear_filters`, `list_filters`, `model_info`, `list_models`. Verified by reading `src/services/PerplexityApiService.ts`, `src/schemas/toolSchemas.ts`, `src/schemas/types.ts` directly, not from the task description alone.

---

## Recommended Plan

Ordered by value and risk. Steps 1–2 are correctness fixes on existing tools (do these first, one is a silent no-op bug, the other is a straightforward additive fix on the same tool). Steps 3–6 are additive Agent API capability (high value, well documented, zero risk to existing behavior). Steps 7–8 are best-effort passthrough for two fields the changelog documents in prose but the formal API reference doesn't yet list as request params, implement defensively. Step 9 is the SDK version bump, sequenced last because it's the one change that could theoretically touch already-working code paths, so it should land once everything else is written and can be smoke-tested against the same PR.

### Step 1 (fix: likely-dead parameter), `raw_search`'s `search_mode` does not appear to be a valid Search API field

**Finding**: The official `POST /search` API reference body (https://docs.perplexity.ai/api-reference/search-post, scraped 2026-08-24) lists exactly these params: `query`, `country`, `max_results`, `search_context_size`, `max_tokens`, `max_tokens_per_page`, `search_language_filter`, `search_domain_filter`, `last_updated_after_filter`, `last_updated_before_filter`, `search_after_date_filter`, `search_before_date_filter`, `search_recency_filter`. **No `search_mode`.** The page itself draws the line explicitly: *"Search API vs. Sonar. These are different APIs... Both are first-party Perplexity APIs."* Every current example of academic/SEC-style filtering on the Search API side (the People Search doc, the SEC Filing Search cookbook) uses `search_domain_filter` with an explicit domain list (`arxiv.org`, `sec.gov`, `edgar.sec.gov`, `.edu`, etc.), never `search_mode`. `search_mode: "web"|"academic"|"sec"` is a **Sonar Chat Completions** field (confirmed on `/api-reference/sonar-post` and `/docs/sonar/filters`), not a Search API field.

This is not new in this delta window, the 2026-05-31 note already flagged it as Conflict Note #4 ("verify this is being passed correctly... or handled gracefully"), but it was apparently never resolved in code. `PerplexityApiService.rawSearch()` (`src/services/PerplexityApiService.ts:96`) still unconditionally forwards `args.search_mode` as `params["search_mode"]` to `client.search.create()`. Given the API's established pattern of silently ignoring unrecognized snake_case keys (this is exactly the class of bug the CLAUDE.md already warns about for camelCase keys), this parameter is most likely accepted and silently dropped, producing no error but also no effect, the worst kind of bug because it looks like it works.

**Confidence**: documented-but-ambiguous. I did not have a live API key to empirically confirm the no-op; the inference rests on the absence of the field from the authoritative reference page plus the consistent absence from every current first-party example. Recommend a quick empirical check (one `raw_search` call with `search_mode: "academic"` against a query where academic vs. general web results are visibly different) before deleting the parameter outright.

**Fix**: Remove `search_mode` from the `raw_search` tool schema and `RawSearchArgs`/`rawSearch()`, and update the tool description to point academic/SEC-style narrowing at `search_domain_filter` (e.g. `["arxiv.org", "pubmed.ncbi.nlm.nih.gov", ".edu"]` or `["sec.gov", "edgar.sec.gov"]`). Do **not** touch `search_mode` on the `search` and `async_research` tools, those correctly target Sonar Chat Completions, where the field is real and confirmed current.

### Step 2 (additive fix, same tool): add `search_context_size` to `raw_search`

**Finding**: `search_context_size: "low"|"medium"|"high"` (default `"high"`) is now a confirmed, current, top-level Search API field, added in SDK `0.32.0` ("add search_context_size to search and web_search tool", 2026-06-02) and present in the official `/api-reference/search-post` body list scraped 2026-08-24: *"Controls how much content is extracted from result pages... Omit when using `max_tokens` or `max_tokens_per_page`."* This directly reverses the 2026-05-31 note's Conflict Note #3, which (correctly, at the time) said SDK `0.30.1` had removed it from the Search API. It's back, under the same name, with the same semantics description as the old `snippet_mode` field mentioned in the prior research note, `snippet_mode` no longer appears anywhere in current docs, so treat it as superseded/renamed rather than something to implement separately.

**Confidence**: documented-and-verified (2 independent sources: official API reference + SDK generated types, cross-checked 2026-08-24).

**Fix**: add `search_context_size?: "low"|"medium"|"high"` to `RawSearchArgs`, wire it through `rawSearch()` as `params["search_context_size"]`, and add the enum property to the `raw_search` tool schema (mirror the existing `search` tool's `search_context_size` description, but note the Search-API-specific default is `"high"`, not `"low"`).

### Step 3 (new capability, high value): `mcp` built-in tool for `agent`

**Finding**: The Agent API gained a native `mcp` built-in tool (SDK `0.34.0`, "add `mcp` tool and typed `mcp_list_tools`/`mcp_call` output items", 2026-07-02; fully documented at https://docs.perplexity.ai/docs/agent-api/tools/mcp, scraped 2026-08-24). This lets an Agent API run connect to an arbitrary remote MCP server (Streamable HTTP only, no legacy SSE) and call its tools natively, without hand-writing a `function` tool wrapper. Exact shape, verbatim from the official reference:

```json
{
  "type": "mcp",
  "server_label": "github",           // required, ^[a-zA-Z0-9_-]{1,64}$, unique per request
  "server_url": "https://...",        // required, HTTPS, Streamable HTTP endpoint
  "authorization": "<token>",         // optional, raw bearer token, never echoed/logged
  "headers": { "X-Foo": "bar" },      // optional, extra request headers
  "allowed_tools": ["tool_a"],        // optional, allowlist; omit = expose everything discovered
  "defer_loading": true               // optional, default false, keeps schemas out of initial context
}
```

Response gains two new output item types when this tool is used: `mcp_list_tools` (once per server, tools discovered at run start) and `mcp_call` (once per invocation); with `defer_loading: true`, also `tool_search_output`. Discovery failures return HTTP 424 `external_connector_error` with no `output` array at all (the whole request fails, not just that tool). Tool-call failures are per-item (`error` string on the `mcp_call` item, request still succeeds). **No per-invocation fee**, only model token usage is billed. **Safety note the docs themselves surface**: "Agent API does not support MCP approvals yet. Every MCP tool call auto-runs", connect only trusted servers.

**Design decision for our schema**: the existing `tools` param on our `agent` tool is a flat array of string enum values (`VALID_AGENT_TOOLS`), each mapped 1:1 to `{type: t}` in `agentRespond()` (`PerplexityApiService.ts:145`). The `mcp` tool type doesn't fit that shape, it needs a compound object, not a bare string. Two ways to reconcile, in order of preference:

- **(a) Recommended: add a separate `mcp_servers` array param**, independent of `tools`, e.g. `mcp_servers?: {server_label, server_url, authorization?, headers?, allowed_tools?, defer_loading?}[]`. In `agentRespond()`, map each entry to `{type: "mcp", ...entry}` and append to the `tools` array built from the string-enum list. This keeps `tools` a simple flat enum (consistent with the schema-design precedent in `agent-tool-default-model-mcp-schema-design.md`, MCP tool-calling LLMs handle flat enums far more reliably than nested unions) while still exposing the full `mcp` shape through ordinary object properties, no `oneOf`/`anyOf` needed at any level.
- (b) Alternative, extend `tools` to accept `string | {type: "mcp", ...}` items via a schema `oneOf` per array item (not root-level, so likely more tolerated than the root-level case the prior research flagged as broken across clients), more "correct" relative to the raw API shape, but adds schema complexity for one tool type. Not recommended unless (a) proves awkward in practice.

**Confidence**: documented-and-verified (dedicated docs page + SDK typed output items, cross-checked 2026-08-24).

### Step 4 (new capability, high value): `skills` param for `agent`

**Finding**: New top-level `skills` array param (SDK `0.37.0`, "add skills param with built-in and inline skills", 2026-07-17; confirmed on the official `/api-reference/agent-post` body list and https://docs.perplexity.ai/docs/agent-api/skills). Max array length **16**. Two variants, discriminated by `type`:

```json
// Built-in
{ "type": "builtin", "name": "office" }              // umbrella: all 4 Office formats
{ "type": "builtin", "name": "office/pdf" }           // or a specific leaf
// office/docx, office/pptx, office/xlsx also valid

// Inline (request-scoped, caller-defined)
{
  "type": "inline",
  "name": "my-skill",              // lowercase ASCII, single hyphens, 1-64 chars
  "description": "...",
  "instructions": "..."            // up to 65,536 bytes
}
```

Behavior notes worth surfacing in the tool description: skill *metadata* is disclosed to the model up front; full instructions load on demand via an internal `load_skill` tool call. **Selecting any skill auto-enables the sandbox tool** for that request (so callers don't need to also add `"sandbox"` to `tools`). Skill-using requests run on Perplexity's "durable backend" (implies good pairing with `background: true` for anything nontrivial). Skills are **not echoed back** on the Response object. Inline skills, unlike built-in ones, cannot mount supporting files into the sandbox.

**Confidence**: documented-and-verified (official API reference body list + dedicated skills doc page + SDK generated types all agree, cross-checked 2026-08-24).

**Schema shape recommendation**: same pattern as `mcp_servers` above, a `skills` array of plain objects with a `type` discriminator (`"builtin"|"inline"`) and the associated fields, `oneOf`'d per-array-item (not at schema root). This mirrors the shape of the raw API closely enough that no translation layer is needed beyond a straight pass-through.

### Step 5 (new capability, straightforward): `previous_response_id`

**Finding**: New top-level string field on `/v1/agent`, confirmed in the official reference: *"OpenAI-compatible previous response id for multi-turn response chains. When set, the new response continues from the completed prior response's saved state. The prior response must belong to the same account and have completed."* This is the standard OpenAI Responses API continuation pattern, lets a caller chain agent turns without re-sending the full conversation, and (per the field's own description) works together with `store` (below).

**Confidence**: documented-and-verified (single source, but it's the primary official API reference, i.e. top of the evidence hierarchy).

**Fix**: add `previous_response_id?: string` to `AgentArgs`/`agentRespond()`/the `agent` tool schema, trivial pass-through, no translation needed.

### Step 6 (new capability, straightforward): `store`

**Finding**: New top-level boolean field on `/v1/agent`, confirmed in the official reference: *"OpenAI-compatible storage toggle. When `false`, the response is hidden from later retrieve calls, and the echoed response reports `store: false`. It can still be used as a `previous_response_id` continuation source."* Relevant to our `agent_retrieve` tool, if a caller sets `store: false`, `agent_retrieve` will not be able to find that response later (but a subsequent `agent` call can still chain off it via `previous_response_id`).

**Confidence**: documented-and-verified (official API reference, same page).

**Fix**: add `store?: boolean` to `AgentArgs`/`agentRespond()`/the `agent` tool schema. Document the `agent_retrieve` interaction in both tools' descriptions.

### Step 7 (best-effort passthrough): `service_tier`

**Finding**: `service_tier: "priority"` is used in a live changelog request-body example (August 2026 entry: *"send `service_tier: 'priority'` to use it"*, referring to GPT-5.6 Sol Fast mode) and is referenced again for the `fast` preset (*"If you use a frozen configuration, update the model and reasoning effort and set `service_tier` to `priority`. Priority processing uses 2× the model's standard token prices."*). The Agent API Models and Output Control doc pages echo `service_tier` in *response* JSON (`"service_tier": "default"` observed), confirming it's a real field. **However**, it is **absent from the formal `/api-reference/agent-post` request-body parameter list** as scraped 2026-08-24, a genuine gap between Perplexity's own reference generator and their changelog/guide prose, not something on our side to resolve.

**Confidence**: documented-but-ambiguous. Real field (multiple independent prose sources + response echo), but not in the canonical parameter schema, implement as an untyped passthrough (consistent with how this codebase already handles fields reached via `as any`), not as a strictly-typed enum, until the formal reference catches up. Only known value so far is `"priority"` (vs. implied `"default"`).

**Fix**: add `service_tier?: string` (free-form, not a closed enum, given the incomplete documentation) to `AgentArgs`, pass through in `agentRespond()`. Low priority relative to Steps 3–6; mention 2x pricing in the tool description so callers don't set it by accident.

### Step 8 (best-effort passthrough): `prompt_cache_key`

**Finding**: Same evidentiary situation as `service_tier`. The August 2026 changelog entry states presets now use *"stable prompt cache keys automatically... No request changes are required, and an explicit `prompt_cache_key` still overrides the preset default."* The presets doc page lists a `prompt_cache_key` value per preset (`fast`/`low`/`medium`/`high`/`xhigh` map to cache keys of the same names). Also echoed in Output Control's response JSON example (`"prompt_cache_key": null`). **Also absent from the formal `/api-reference/agent-post` request-body list.**

**Confidence**: documented-but-ambiguous, same caveat as Step 7.

**Fix**: add `prompt_cache_key?: string` to `AgentArgs`, pass through. This is a pure cost-optimization knob (~5% savings on preset-heavy workloads per the changelog) with no behavioral downside if omitted, lowest priority of the additive fields, but trivial to add alongside Step 7 since both are simple optional passthrough strings.

### Step 9 (sequenced last): bump the SDK from `0.31.0` to current (`0.38.3` at time of writing)

**Finding**: `package.json` pins `^0.31.0` and `node_modules` has literally `0.31.0`, the lockfile has not moved since the 2026-05-31 audit. Full changelog for every intervening release (from `https://raw.githubusercontent.com/perplexityai/perplexity-node/main/CHANGELOG.md`, fetched 2026-08-24):

| Version | Date | Change |
|---|---|---|
| 0.38.3 | 2026-08-11 | chore: sync generated API SDKs |
| 0.38.2 | 2026-08-10 | chore: sync generated API SDKs |
| 0.38.1 | 2026-07-30 | fix: publish stable GitHub releases; chore: sync generated API SDKs |
| 0.38.0 | 2026-07-30 | **Breaking**: dropped CommonJS support, TS5 prep, aliased generated-API names, SDK facade sync. Also: Bazel/oxc/pnpm tooling migration (build-system only, no runtime effect) |
| 0.37.0 | 2026-07-17 | feat: add `skills` param with built-in and inline skills |
| 0.36.0 | 2026-07-15 | feat: manual API updates; fix: `@arethetypeswrong/cli` bump, Node 24 CI |
| 0.35.0 | 2026-07-09 | feat: manual API updates |
| 0.34.0 | 2026-07-02 | feat: add `mcp` tool and typed `mcp_list_tools`/`mcp_call` output items; fix: send content-type header for requests with omitted optional body |
| 0.33.0 | 2026-06-08 | feat: add files subresource for sandbox file retrieval |
| 0.32.0 | 2026-06-02 | feat: add `search_context_size` to search and `web_search` tool |
| 0.31.0 | 2026-05-30 | (already installed) feat: add sandbox built-in tool |

**Breaking-change assessment**: `0.38.0`'s "dropped CommonJS support" is the only item flagged as breaking. This project is already pure ESM (`package.json` has `"type": "module"`; `tsconfig.json` has `"module": "Node16"`, `"moduleResolution": "Node16"`), and every call site already uses `import`. **Low risk**, but confirm with a clean `npm install && npm run build` after bumping, since 0.38.0's own changelog also mentions "aligned aliases with generated API" and a full generated-client refactor (the package's internal file layout changed enough that `unppkg`-hosted `.d.ts` paths moved from `resources/responses.d.ts` to `dist/resources/responses/responses.d.ts` re-exporting from `dist/generated/api.d.ts`, this is almost certainly transparent to consumers using the public `client.chat.completions`/`client.search`/`client.responses`/`client.embeddings`/`client.async.chat.completions` surface this codebase already uses via `as Function`/`as any`, but it's exactly the kind of refactor that's worth a build+smoke-test pass rather than a blind bump).

**Also unlocked by this bump**: SDK `0.33.0`'s "files subresource for sandbox file retrieval" (`client.responses.files...` or similar, not yet verified in detail; low priority, only useful if we later expose fine-grained sandbox output retrieval beyond the existing `sandbox` tool + `agent_retrieve`).

**Fix**: `npm install @perplexity-ai/perplexity_ai@latest` (or pin `^0.38.3` in `package.json`), then `npm run build` and manually smoke-test each of the 12 tools (or at minimum: `search`, `raw_search`, `agent` with a `web_search` call, `agent_retrieve`) before merging. Do this in the same PR as Steps 1–8 so the new fields (`mcp`, `skills`, `previous_response_id`, `store`) are exercised against the SDK version that actually types them, even though this codebase's `as any`/`as Function` casts mean the TypeScript compiler won't catch a mismatch either way, per CLAUDE.md, "verify request-param names against `node_modules/@perplexity-ai/perplexity_ai/resources/*.d.ts`" only works if `node_modules` is current.

---

## Gap Analysis Table

| Capability | Status | MCP tool | Field name / nesting | Source |
|---|---|---|---|---|
| `search_mode` on Search API | **Likely dead/no-op** (pre-existing, not new this window) | `raw_search` | top-level `search_mode` sent to `client.search.create()` - not in the API's documented schema | [Search API reference](https://docs.perplexity.ai/api-reference/search-post), [People Search](https://docs.perplexity.ai/docs/search/filters/people-search), [SEC Filing cookbook](https://docs.perplexity.ai/docs/cookbook/examples/sec-filing-search/README) |
| `search_context_size` on Search API | **New since May** (SDK 0.32.0, 2026-06-02) | `raw_search` | top-level `search_context_size: "low"\|"medium"\|"high"` (default `"high"`) | [Search API reference](https://docs.perplexity.ai/api-reference/search-post) |
| `search_type: "people"` on Search API | Already covered, confirmed still current | `raw_search` | top-level `search_type: "web"\|"people"` | [People Search](https://docs.perplexity.ai/docs/search/filters/people-search) |
| `mcp` built-in tool | **New since May** (SDK 0.34.0, 2026-07-02) | `agent` | `tools[]` item: `{type:"mcp", server_label, server_url, authorization?, headers?, allowed_tools?, defer_loading?}` | [MCP tool docs](https://docs.perplexity.ai/docs/agent-api/tools/mcp) |
| `skills` (builtin + inline) | **New since May** (SDK 0.37.0, 2026-07-17) | `agent` | top-level `skills[]`, max 16, items `{type:"builtin", name}` or `{type:"inline", name, description, instructions}` | [Skills docs](https://docs.perplexity.ai/docs/agent-api/skills), [Agent API reference](https://docs.perplexity.ai/api-reference/agent-post) |
| `previous_response_id` | **New since May** | `agent` | top-level `previous_response_id: string` | [Agent API reference](https://docs.perplexity.ai/api-reference/agent-post) |
| `store` | **New since May** | `agent` | top-level `store: boolean` | [Agent API reference](https://docs.perplexity.ai/api-reference/agent-post) |
| `service_tier` | **New since May, documented-but-ambiguous** | `agent` | top-level `service_tier: "priority"` (implied `"default"`); 2× pricing when `"priority"` | [Changelog](https://docs.perplexity.ai/docs/resources/changelog) (Aug 2026 entries), [Agent API Models](https://docs.perplexity.ai/docs/agent-api/models) - **not** in formal `/api-reference/agent-post` body list |
| `prompt_cache_key` | **New since May, documented-but-ambiguous** | `agent` | top-level `prompt_cache_key: string`, overrides preset's automatic cache key | [Changelog](https://docs.perplexity.ai/docs/resources/changelog) (Aug 2026), [Presets](https://docs.perplexity.ai/docs/agent-api/presets) - **not** in formal `/api-reference/agent-post` body list |
| `connector` tool type | New since May, low priority | `agent` (not recommended for exposure yet) | `tools[]` item: `{type:"connector", id, server_label, server_description?, allowed_tools?}` | SDK generated types (`dist/generated/api.d.ts`, via unpkg 2026-08-24) - no dedicated doc page found |
| `function` tool type | Pre-existing capability, out of scope | `agent` (not recommended for exposure) | `tools[]` item: `{type:"function", name, description?, parameters?, strict?}` | SDK generated types, same source |
| `tools`/`tool_choice`/`parallel_tool_calls` on Sonar Chat Completions | Exists, out of scope for this wrapper | `search` (not recommended) | top-level on `client.chat.completions.create()` | SDK generated types (`CompletionCreateParams`) |
| Sonar Chat Completions → Agent API migration | **Strategic, non-breaking** | `search`/`async_research` (architectural) | N/A - `/v1/sonar` remains supported; migration guide maps `sonar`→`fast`, `sonar-pro`→`low`, `sonar-reasoning-pro`→`medium`, `sonar-deep-research`→`high` presets | [Migrate from Sonar](https://docs.perplexity.ai/docs/agent-api/migrate-from-sonar/overview), [Changelog](https://docs.perplexity.ai/docs/resources/changelog) (Jul 2026) |
| Perplexity's own MCP server moved Sonar→Agent API presets | Informational only (different codebase) | N/A | `perplexity_ask`→`fast`, `perplexity_reason`→`medium`, `perplexity_research`→`high`; dropped `strip_thinking`/`reasoning_effort` from their schemas | [Changelog](https://docs.perplexity.ai/docs/resources/changelog) (Jul 2026, "MCP Server 1.0") |
| Remote MCP server (`api.perplexity.ai/mcp`) | Informational only, not applicable (we are a server, not a consumer) | N/A | N/A | [Changelog](https://docs.perplexity.ai/docs/resources/changelog) (Jul 2026) |
| Router/Gateway API (open-weight models, OpenAI/Anthropic-compatible) | New since May, out of scope (separate product) | N/A | Different base URL/product | [Changelog](https://docs.perplexity.ai/docs/resources/changelog) (Jul 2026) |
| New Agent API models (Claude Opus 5, GPT-5.6 sol/terra/luna, Gemini 3.5/3.6/3.7 Flash family, Grok 4.5/4.6/4.20/4.3, Kimi K3/K2.7 Code, GLM 5.2, Nemotron 3 family, DeepSeek V4 Flash) | New since May, no code change needed | `agent`, `list_models` | Dynamically discovered via `GET /v1/models`; no hardcoded model list in our schema | [Changelog](https://docs.perplexity.ai/docs/resources/changelog) (Jun–Aug 2026, multiple entries) |
| `google/gemini-3.1-flash-lite-preview` retired | Deprecation, no action (not referenced in our code) | `agent` | Requests now return `model not supported`; use `google/gemini-3.1-flash-lite` | [Changelog](https://docs.perplexity.ai/docs/resources/changelog) (Jul 2026) |
| SDK CommonJS support | **Breaking (SDK-internal), low risk for us** | N/A (build config) | N/A | [SDK CHANGELOG](https://github.com/perplexityai/perplexity-node/blob/main/CHANGELOG.md) (0.38.0) |
| SDK `0.32.0`–`0.38.3` (7 versions behind) | Version gap | N/A | `package.json` pinned `^0.31.0`, installed `0.31.0` | [SDK CHANGELOG](https://github.com/perplexityai/perplexity-node/blob/main/CHANGELOG.md), [npm](https://www.npmjs.com/package/@perplexity-ai/perplexity_ai) |
| Sandbox file retrieval subresource | New since May, low priority | `agent` (not currently exposed) | SDK `0.33.0` "files subresource for sandbox file retrieval" - shape not yet verified against docs | SDK CHANGELOG only; needs follow-up if pursued |

---

## Documentation Sources

| Source | URL |
|---|---|
| Official changelog (primary source for this delta) | https://docs.perplexity.ai/docs/resources/changelog |
| Feature roadmap (confirms what's still *not* shipped) | https://docs.perplexity.ai/docs/resources/feature-roadmap |
| Search API reference | https://docs.perplexity.ai/api-reference/search-post |
| Agent API reference | https://docs.perplexity.ai/api-reference/agent-post |
| Sonar API reference | https://docs.perplexity.ai/api-reference/sonar-post |
| Sonar API filters guide | https://docs.perplexity.ai/docs/sonar/filters |
| People Search | https://docs.perplexity.ai/docs/search/filters/people-search |
| Agent API - MCP tool | https://docs.perplexity.ai/docs/agent-api/tools/mcp |
| Agent API - Skills | https://docs.perplexity.ai/docs/agent-api/skills |
| Agent API - Presets | https://docs.perplexity.ai/docs/agent-api/presets |
| Agent API - Output Control | https://docs.perplexity.ai/docs/agent-api/output-control |
| Agent API - Models | https://docs.perplexity.ai/docs/agent-api/models |
| Migrate from Sonar to Agent API | https://docs.perplexity.ai/docs/agent-api/migrate-from-sonar/overview |
| SEC Filing Search cookbook | https://docs.perplexity.ai/docs/cookbook/examples/sec-filing-search/README |
| Academic Search cookbook | https://docs.perplexity.ai/docs/cookbook/articles/academic-search/README |
| SDK CHANGELOG.md | https://github.com/perplexityai/perplexity-node/blob/main/CHANGELOG.md |
| SDK npm page | https://www.npmjs.com/package/@perplexity-ai/perplexity_ai |
| SDK generated types (unpkg, `dist/generated/api.d.ts`) | https://unpkg.com/@perplexity-ai/perplexity_ai@latest/dist/generated/api.d.ts |
| Third-party changelog aggregator (corroboration only, not primary) | https://releases.sh/perplexity/api-changelog |

---

## Supporting Research / Key Findings

### The "Sonar Chat Completions is now Agent API" migration (July 2026): important context, not a forcing function

The July 2026 changelog contains a dedicated entry: *"Sonar Chat Completions migration, More models, tools, and research-backed presets: Sonar Chat Completions is now Agent API. Migration guide here."* Fetching the migration guide directly (https://docs.perplexity.ai/docs/agent-api/migrate-from-sonar/overview) gives a more measured picture than the changelog headline suggests:

- **No deprecation timeline, no sunset date.** The guide's own words: *"While Sonar Chat Completions remains supported, the Agent API is more performant and cost-effective for production workloads."* This is a recommendation, not a mandate, `/v1/sonar` keeps working.
- **Preset mapping** (documented at a high level only): `sonar`→`fast`, `sonar-pro`→`low`, `sonar-reasoning-pro`→`medium`, `sonar-deep-research`→`high`. No granular field-by-field mapping is published for parameters like `search_mode`, `web_search_options.search_context_size`, or `reasoning_effort`, a caller migrating would need to work out the equivalents by hand (roughly: `search_domain_filter` behaves the same on both surfaces via the `web_search` tool's `filters`; reasoning effort maps to the `reasoning.effort` field; the closest response-shape parity is that Agent API returns a typed `output[]` array of items instead of `choices[]`).
- **Perplexity's own reference MCP server already made the jump.** The same July 2026 changelog reports "MCP Server 1.0: now backed by the Agent API", their `perplexity_ask`/`perplexity_reason`/`perplexity_research` tools moved from raw Sonar models to Agent API presets (`fast`/`medium`/`high` respectively), and they dropped `strip_thinking`/`reasoning_effort` from those tool schemas entirely (*"the Agent API emits no think tags, and presets manage reasoning effort; clients still sending them are ignored gracefully"*). That's a different codebase from this one, so it isn't something to copy mechanically, but it's a strong signal about where Perplexity expects new MCP integrations to land, and it validates that our `agent` tool (already built against Agent API presets) is the more future-proof of our two search-style tools.

**Recommendation**: do not migrate `search`/`async_research` off Sonar Chat Completions as part of this pass, there's no forcing function, both surfaces are actively maintained, and rewriting a stable, well-tested tool to chase a "more performant" claim with no measured numbers is unjustified churn. Revisit only if a future changelog entry adds an actual deprecation date for `/v1/sonar`, or if Perplexity retires the `sonar-*` model family.

### `search_mode` and `search_context_size` are not "the same feature, two names": verify the distinction stays intact if implementing Step 1+2 together

It would be easy to conflate these while writing the fix for `raw_search`, since both are "content-depth" knobs that got confused in the 2026-05-31 note. To be precise: `search_context_size` (Search API, and separately as `web_search_options.search_context_size` on Sonar) controls **how much page content is extracted per result**. `search_mode` (Sonar-only) controls **which corpus is searched** (general web vs. academic vs. SEC filings). They are unrelated knobs that happen to both be `low`/`medium`/`high`-flavored... except `search_mode` isn't even an enum of depths, it's `web`/`academic`/`sec`, so the confusion is really just that both showed up near each other in the same changelog entries historically ("The academic filter works seamlessly with other search parameters like `search_context_size`"). Keep them as fully separate fields in the fix; don't try to unify them.

### `snippet_mode` (Search API) is superseded, not additive

The 2026-05-31 research listed a `snippet_mode: "low"|"medium"|"high"` field on the Search API (added Sep 2025) with the description *"controls extraction depth; omit when using max_tokens or max_tokens_per_page."* That exact description, verbatim, "omit when using max_tokens or max_tokens_per_page", is now attached to `search_context_size` in the current official reference, and `snippet_mode` appears nowhere in current docs, the SDK's generated types, or the changelog between May and August. This wasn't ever implemented in `raw_search` (confirmed by reading the current code), so there's no removal to make, just don't implement `snippet_mode` as a separate field when doing Step 2; `search_context_size` is its replacement.

### Router API / Gateway API: confirmed out of scope, noted for completeness

July 2026 introduced a new, separate **Router API** (changelog calls it "Router API" in the July entry, "Gateway API" in the July 30 `releases.sh` third-party summary, same product, inconsistent naming across Perplexity's own sources) at a different base URL, providing OpenAI Chat Completions and Anthropic Messages-compatible access to open-weight models Perplexity hosts (Kimi, GLM, Nemotron, DeepSeek, etc.) with automatic failover and per-token pricing. It uses the same Perplexity API key. This is a genuinely different product surface (different endpoint family, different compatibility contract) from Sonar/Search/Agent/Embeddings, out of scope for this delta pass, flagged only so it isn't mistaken for missing Agent API model coverage (the open-weight models are also reachable through the Agent API's `model`/`models` fields using `perplexity/<model>` ids, per the changelog's Nemotron/DeepSeek entries, so no functionality is actually missing from our `agent` tool here, it's just that the Router API additionally offers those same models via a raw completions-compatible endpoint).

### SDK internal restructure (0.38.0): file-layout change, not a public API change

While researching the SDK delta, direct GitHub source fetches for `src/resources/responses.ts` 404'd post-refactor; the working path via the published npm package moved to `dist/resources/responses/responses.ts` (a thin re-export) with the actual generated types living in `dist/generated/api.d.ts`. This is purely an internal build/codegen reorganization (Stainless-style generated-client pattern, consistent with 0.38.0's changelog: "Refactors: Generated TypeScript client binding consumption"). The public consumption surface this codebase uses (`client.chat.completions.create`, `client.search.create`, `client.responses.create`/`.retrieve`, `client.async.chat.completions.*`, `client.embeddings.create`, `client.get()`) is unaffected in every doc/type source checked. Flagging only so a future researcher doesn't waste time on the same 404s, go straight to `https://unpkg.com/@perplexity-ai/perplexity_ai@latest/dist/generated/api.d.ts` for current generated types.

---

## Best Practices & Potential Issues

- **`raw_search`'s `search_mode` bug (Step 1) should be verified empirically before merging the fix**, ideally with one live call comparing `search_mode: "academic"` vs. omitted against a query with an obviously different expected result set (e.g. a topic with both a Wikipedia-style page and an arXiv paper). If the results are identical, that confirms the no-op; if they differ, the field is doing *something* undocumented and the fix should be reconsidered (possibly the API accepts it as an alias nobody wrote down).
- **`service_tier` and `prompt_cache_key` (Steps 7–8) are the two weakest-sourced additions in this note.** They're real (used in changelog prose, echoed in response JSON) but conspicuously absent from the one page that's supposed to be authoritative for request params. Implement them as loosely-typed optional passthroughs, not strict enums, and don't be surprised if Perplexity's reference generator adds them formally in a future month, re-check this note's Step 7/8 status then.
- **Do not add `mcp`/`skills` as `oneOf` members inside the existing flat `tools` string-enum.** The linked prior research (`agent-tool-default-model-mcp-schema-design.md`) found hard, multi-source evidence that MCP tool-calling LLMs (including Claude Code itself) don't reliably honor `oneOf`/`anyOf`, especially at schema root. Keep `tools` as-is (flat enum of tool-name strings) and add `mcp_servers`/`skills` as separate, independently-optional array params, this sidesteps the union-type reliability problem entirely rather than working around it.
- **The `mcp` tool's `authorization` field is a raw bearer token in the request body.** If this MCP server ever logs full outbound request bodies for debugging, make sure `authorization` (and any `headers` values) get redacted, Perplexity's own docs stress it's "never logged or echoed" on their end, and the same care should extend to any local instrumentation added here.
- **`mcp` tool discovery failures fail the whole run** (HTTP 424, no `output` array) rather than degrading gracefully, if this MCP server exposes `mcp_servers` as a caller-facing param, the tool description should warn that a single unreachable configured server aborts the entire agent call, not just that one tool's contribution.
- **Selecting any `skills` entry silently turns on the sandbox tool.** Worth a one-line note in the `agent` tool description so callers aren't surprised by sandbox-tool billing/behavior appearing on a request where they only asked for `skills`.

---

## Project-Specific Adaptations

**Files to change** (from reading the current implementation directly):

1. `src/schemas/types.ts`, remove `search_mode` from `RawSearchArgs`; add `search_context_size` to `RawSearchArgs`; add `mcp_servers`, `skills`, `previous_response_id`, `store`, `service_tier`, `prompt_cache_key` to `AgentArgs`; add corresponding `Valid*` const arrays/types if going with enum-per-field validation elsewhere in the codebase (skills' `type` field, MCP tool's implied `type: "mcp"`).
2. `src/services/PerplexityApiService.ts`, `rawSearch()`: drop the `search_mode` passthrough (`:96`), add `search_context_size` passthrough. `agentRespond()`: add mapping for `mcp_servers` → `tools` entries (`:145` area, alongside the existing `args.tools.map(...)` line), add `skills`, `previous_response_id`, `store`, `service_tier`, `prompt_cache_key` passthroughs (same `if (args.x !== undefined) body["x"] = args.x` pattern already used throughout this method).
3. `src/schemas/toolSchemas.ts`, `raw_search`: remove `search_mode` property, add `search_context_size` property (mirror the `search` tool's existing enum/description, note default is `"high"` not `"low"`). `agent`: add `mcp_servers`, `skills`, `previous_response_id`, `store`, `service_tier`, `prompt_cache_key` properties; update the tool-level description to mention the new capabilities briefly (it's already fairly long, keep additions terse, one clause each, following the existing style).
4. `package.json`, bump `@perplexity-ai/perplexity_ai` from `^0.31.0` to `^0.38.3` (or current at implementation time); run `npm install`, confirm `node_modules/@perplexity-ai/perplexity_ai/package.json` actually resolves to the new version (it silently didn't move last time, per this note's opening paragraph, worth double-checking after `npm install` that the lockfile/node_modules genuinely updated, not just the `package.json` range string).
5. `CLAUDE.md`, after implementing, update the "MCP Tool Schema" section's `agent` tool description (currently lists `web_search, fetch_url, people_search, finance_search, sandbox` as the built-in tools and doesn't mention `mcp`/`skills`/`previous_response_id`/`store` at all) and add a line noting `raw_search`'s `search_mode` removal + `search_context_size` addition, consistent with how this file already documents past param fixes (see the existing "A prior bug sent camelCase..." line for the established style).

**Do not change**: `search`, `async_research`'s `search_mode` (both correctly target Sonar Chat Completions, confirmed still valid); the `low`-preset default-injection logic in `agentRespond()` (still correct per the current presets page, `low` is still a valid preset name, unaffected by the July/August preset *model* reassignments which are server-side and transparent to callers); `VALID_AGENT_PRESETS`/`VALID_AGENT_REASONING_EFFORT` (both still accurate against the current API reference).
