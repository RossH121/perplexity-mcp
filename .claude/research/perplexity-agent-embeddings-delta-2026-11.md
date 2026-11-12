# Perplexity Agent API / Embeddings / Models delta: 2026-08-24 → 2026-11-12

## 2026-11-12: Gap analysis for agent, agent_retrieve, agent_cancel, agent_files, embeddings, contextualized_embeddings, list_models

**Shape**: engineering plan (gap analysis)

Delta against [`perplexity-api-delta-2026-08.md`](./perplexity-api-delta-2026-08.md) (all of its Steps 1-9 are implemented in the working tree, verified by reading `src/services/PerplexityApiService.ts`, `src/schemas/types.ts`, `src/schemas/toolSchemas.ts`). Schema-design precedent from [`agent-tool-default-model-mcp-schema-design.md`](./agent-tool-default-model-mcp-schema-design.md) still applies: flat enums, separate array params instead of per-item `oneOf`, server-side defaults. Out of scope here: Sonar chat completions, `/search`, async research, MCP SDK.

**Codebase snapshot**: `package.json` `^0.38.3`, `node_modules` has `0.38.3` installed. Latest SDK is **0.41.0** (2026-10-22).

---

## Recommended plan

Ordered: breaking/deprecation first, then correctness of what we already expose, then additive features, then new tools.

### Step 1 (deprecation, the headline item): `preset` renamed to `effort`

- October 2026 changelog: *"Agent API: `preset` renamed to `effort`. This is a naming change only."* `preset` "remains a deprecated alias". SDK 0.41.0: "add effort to Responses, deprecate preset".
- SDK generated types (0.41.0): `preset?: string` carries `/** @deprecated Use effort instead. If both are supplied, effort takes precedence when non-null. */`. The response also has `effort?: string` (`name@<version>`), with `preset` deprecated there too.
- The formal `/api-reference/agent-post` body list **no longer contains `preset` at all**. It lists `effort` (string, *not an enum*: `name`, `name@latest`, or `name@<version>`, e.g. `fast@2026-09-29.0`). "Required if `model` is absent. Cannot be combined with `profile`."
- **Empirical check (2026-11-12, top of the evidence hierarchy)**: `agent({preset:"fast"})` still works (ran on `openai/gpt-6-luna`), and so does `preset:"wide-research"` (ran on `anthropic/claude-opus-5-5`). So this is **not breaking yet**, but we are sending a deprecated field on every default call: `agentRespond()` injects `body["preset"] = "low"`.

**Fix**: send `effort` instead of `preset` everywhere. Add an `effort` tool param. Keep `preset` as a deprecated alias that maps to `effort` server-side, so existing callers don't break. Change the default injection to `body["effort"] = "low"`. Update the `AgentHandler.enrichIfModelError` message ("or a 'preset' instead") and the docs. Don't send both fields.

**Naming trap**: top-level `effort` (which configuration bundle to run) is a different field from our existing `reasoning_effort` → `reasoning.effort` (how hard the model reasons). The effort page: *"`effort` is separate from `reasoning.effort`"*. Keep `reasoning_effort` as it is, and make the two descriptions point at each other so an LLM caller doesn't mix them up.

### Step 2 (fix): the effort-level list and version pinning

- Effort page (current): `fast`, `low`, `medium`, `high`, `xhigh`, `ultra`. `wide-research` isn't on that page any more. October changelog: "`wide-research` now selects `xhigh`" (this matches the empirical run on opus-5-5). Also from October: the old undocumented `ultra` was removed, and `ultra-preview` was added. November: "The Agent API accepts `effort="ultra"`... `ultra@2026-11-05.0` ... runs on `anthropic/claude-opus-5-5`. Runs can be long, so background mode is suggested." So right now `ultra` is valid, and `ultra-preview` has dropped off the docs page (its status is ambiguous).
- Pinning: `low@2026-11-11.0`. An unknown name or version returns 400. The response's `effort` field echoes the exact version that ran, and you can send that value back to pin it.
- Our schema has `enum: VALID_AGENT_PRESETS` = fast/low/medium/high/xhigh/wide-research. That **blocks `ultra` and every pinned version at the client**. `isValidAgentArgs` only checks `typeof string` (permissive, good).

**Fix**: make `effort` a free `string` in the schema. Put the six names and the `@version` syntax in the description instead of an enum, because the API itself treats it as a pattern, not an enum. Mark `wide-research` as a legacy alias of `xhigh`. Also update `VALID_AGENT_PRESETS`, which other code and docs may reference.

### Step 3 (fix): `max_steps` ceiling is now 500

The API reference says `max_steps` is 1-500, and the October changelog says "`max_steps` accepts up to 500". Our schema description says "(1-100)", and CLAUDE.md records "real API ceiling is 100" (true on 2026-08-24, stale now). The reference also says direct-model requests default to 1 step, and that `finance_search` on a direct model needs at least 3. That deserves a sentence in the description, because a bare `model:` run with tools gets only one step.

### Step 4 (fix): `service_tier` is now documented, with an expanded value set

- Agent Models page: omit it or use `auto`/`default` for standard processing, `flex` (0.5x price, best effort), `priority` (2x), and `fast` as an alias for `priority`. *"An unsupported tier does not cause the request to be rejected."* The response's `service_tier` reports the tier that actually served the request.
- SDK 0.41.0 type: `service_tier?: "auto" | "default" | "flex" | "priority" | "fast"`. That's two independent sources. The formal `/agent-post` body list still omits it (and `prompt_cache_key`), so the doc gap from August persists.
- Our description mentions only `priority`. **Fix**: list all five values, mention `flex` at half price (OpenAI models only, per the models page), and keep the field a loose string since unsupported values are accepted silently.

### Step 5 (feature): render the output and status values we currently drop

`renderAgentResponse()` handles only `message`, `search_results`, and `fetch_url_results`. Since August the API added these:
- `image_search_results` (October, `image_search` tool): `results[]` with `image_url`, `origin_url`, `width`, `height`, `title?`, and `error: "image_search_failed"` on failure.
- `mcp_approval_request` (October, tool approvals): `id`, `server_label`, `name`, `arguments` (JSON string), `thought_signature?`. **If we add `require_approval` (Step 7) without rendering this item, the caller sees "(no text output)" and can't approve anything.**
- `share_file` (the sandbox file-delivery item). It's a useful hint to call `agent_files`.
- Status: the reference enum is `queued`, `in_progress`, `completed`, `failed`, `incomplete`, `cancelled`. Background-mode docs add a `paused` object (token-limit pause while the status stays `in_progress`), plus `cancelling` from cancel. `PENDING_STATUSES` includes `requires_action`, which no current doc lists. It's harmless but dead.
- The `effort` echo (`name@version`) and `service_tier` echo are worth one header line (like `[Agent model: ...]`), so callers can pin what ran.
- Empirical: `model:"openai/gpt-5", max_output_tokens:16` returned `status: incomplete` and "(no text output)". When a response is `incomplete`, surface `incomplete_details` or `error`, if present, rather than a bare status.

### Step 6 (feature): `image_search` built-in tool, and per-tool options

- New built-in `image_search` (October). Options: `max_results` 1-30 (default 5), and `filters.domain_filter` (≤10, `-` prefix excludes), `filters.format_filter` (bmp/gif/jpeg/png/webp/svg), `filters.safe_search` (default true). $2.50 per 1,000 invocations.
- Adding `"image_search"` to `VALID_AGENT_TOOLS` is the S-effort part.
- `web_search` tool objects now take `search_type: "web"|"fast"` (September; fast is $1.00 vs $2.50 per 1k, about 800 ms quicker). If omitted, the tool inherits the effort level's setting, which since October is `fast` for every effort level. They also take `max_results` (1-50), `max_tokens`, `max_tokens_per_page`, `user_location`, and `filters` (domain/recency/date filters). `fetch_url` takes `max_urls` (1-10), and `people_search` takes `max_tokens`/`max_tokens_per_page`. Our flat-enum `tools` param can't express any of these.
- **Recommendation**: keep `tools` as a flat enum (per the schema-design precedent), and add one optional object param, `web_search_options: {search_type, max_results, filters..., user_location}`, which `agentRespond()` merges into the `web_search` tool entry. Optionally add an `image_search_options` param the same way. That covers the high-value knobs without per-item `oneOf`. Medium effort.

### Step 7 (feature): MCP tool approvals, connectors, and the approval round-trip

- `require_approval` on `mcp` and `connector` tools (October): `"never"`, `"always"`, `null`, or `{never?: {tool_names?, read_only?}, always?: {...}}`. A gated call returns an `mcp_approval_request` and **does not run**. To continue, send a new request with `previous_response_id` plus `input` items `{type:"mcp_approval_response", approval_request_id, approve, reason?}` (`reason` is allowed only when `approve:false`), and **resend the same `tools`**, because they aren't reused from the previous response. ZDR orgs can't use `previous_response_id`.
- This directly fixes the "every MCP tool call auto-runs" warning in our `mcp_servers` description and in the 2026-08 note. That warning is now only true by default.
- Connectors (September: custom BYO MCP; managed connectors listed on the connectors page): `{type:"connector", id, server_label, server_description?, allowed_tools?, require_approval?}`. Managed IDs: `connector_github`, `connector_slack`, `connector_googledrive`, `connector_datadog`, `connector_linear`, `connector_notion`. Custom connectors support SSE and store the credential on Perplexity's side, so no bearer token goes in our request body (a security improvement over `mcp_servers.authorization`). Connectors use deferred discovery, and the docs suggest `max_steps` of 6-12. There's no API to list connectors (console only).
- **Fix**: add `require_approval` to `mcp_servers[]` items. Add a `connectors[]` array param mapped to `{type:"connector", ...}` (same pattern as `mcp_servers`). Add an `approval_responses: [{approval_request_id, approve, reason?}]` param that switches `input` to item-array form (same mechanism as `images`). Render `mcp_approval_request` (Step 5).

### Step 8 (feature): `input_file` document input

October: PDF, DOC, DOCX, TXT, and RTF as `{type:"input_file", file_data | file_url, filename?}` content parts. `file_data` is base64 or a data URI; `file_url` is public HTTPS (and is treated as a PDF if `filename` is omitted). Limits: 30 documents, 50 MiB of decoded inline data, a 72 MiB body, filename ≤255 bytes. **`file_id` is not supported**, so Files API uploads can't be referenced. ZDR orgs can't use document input, and browser tools can't run with documents. Inline documents persist through a `previous_response_id` chain for the original response's retention period (≤30 days).

**Fix**: add a `files: [{file_url?, file_data?, filename?}]` param, wrapped into the same user message as `images` in `agentRespond()`. Validate exactly-one-of `file_data`/`file_url`. Add a `validate-params.mjs` check.

### Step 9 (feature): `profile`, `tool_choice`, custom skills

- `profile: {type:"custom", id, version?}`: a saved, versioned config (model, instructions, reasoning, tools, skills, connectors, steps). Profiles are managed only in the API Portal (no API). **Cannot be combined with `effort`.** Request fields override the profile's values, except `tools`, which merge per tool. **Required interaction**: when `profile` is set, our default-effort injection must be skipped, or every profile call will conflict. Check this before shipping.
- `tool_choice`: `"none"|"auto"|"required"` or an object (e.g. `{type:"image_search"}`). S effort as a string enum.
- `skills[].type: "custom"` with `id: "skill_..."` and optional `version` (SDK 0.39.0 "custom Skill management"). Our `AgentSkill` allows only `builtin`/`inline`, and `isValidAgentArgs`/the schema enum reject `custom`. New inline limits: `description` ≤1,024 bytes and a 262,144-byte total for inline instructions. We don't enforce these, which is fine because the API does.

### Step 10 (cleanup): adopt SDK 0.41.0 typed resources

- 0.39.0 added "Agent model catalog": a typed `client.models.list()` (`ModelsResource.list(): APIPromise<ModelListOutput>`, model = `{id, object:"model", created, owned_by}`, the same four fields as before). Replace `(this.client as any).get("/v1/models")` with it, and drop the CLAUDE.md line saying the SDK has no typed models resource.
- 0.39.0 also says "type background response stream reconnection": `responses.retrieve(id, {stream, starting_after})`. The background-mode doc confirms `GET /v1/agent/{id}?stream=true&starting_after=N`, though the formal `agent-get` reference lists no query params (a doc disagreement; we don't stream, so this is informational).
- 0.39.0 "support Agent cache controls and extraction usage": I found no request-side cache field beyond `prompt_cache_key` in the 0.41.0 types (`prompt_cache_retention` is absent). On the usage side, `usage.input_tokens_details.cache_creation_input_tokens`/`cache_read_input_tokens` and sandbox `pplx_sdk.llm.extract` costs now appear (October). Optional: show cache-read tokens in the cost footer.
- Bump `^0.38.3` → `^0.41.0`. Note the workstation's 7-day release-age quarantine; 0.41.0 is about three weeks old, so it clears. Run `npm run build` and `scripts/validate-params.mjs` afterwards.

### Step 11 (docs/fix): embeddings default `encoding_format`

Both `/api-reference/embeddings-post` and `/contextualized-embeddings-post` state the **default is `base64_int8`** and offer only two values. Our tool schema (both tools) and the README say "Omit for full-precision vectors", which is wrong: omitting it gives int8. Everything else (models, dimension ranges 128-1024 for 0.6b and 128-2560 for 4b, 512 inputs, 32K tokens per input, 120K per request, 512 docs and 16,000 chunks for contextualized) matches our current implementation. The path is `POST /v1/contextualizedembeddings`. Usage now includes `cost.{input_cost,total_cost,currency}`, which our summary could show. Confidence: single primary source per endpoint (both are the formal reference). It's not empirically verified, but a one-call check comparing the response length with and without `encoding_format` would confirm it.

### Step 12 (docs): stale model IDs in examples

The live `GET /v1/models` (called 2026-11-12) returns 56 models. **It still lists IDs the docs dropped**: `openai/gpt-5`, `gpt-5-mini`, `gpt-5-nano`, `gpt-5.1`, `gpt-5.2`, `gpt-5.4*` (the September changelog announced their retirement on **2026-10-24**), plus `anthropic/claude-sonnet-4-6`, `claude-opus-4-*`, `claude-haiku-4-5`, and older Gemini/Grok IDs (October: "Older models removed from the model docs"). **Empirically, both `openai/gpt-5` and `anthropic/claude-sonnet-4-6` still serve requests on 2026-11-12.** So the retirement either slipped or isn't enforced yet. Either way, these are bad examples to hard-code.
- Hard-coded examples to replace: `src/schemas/toolSchemas.ts:329` (`openai/gpt-5`, `anthropic/claude-sonnet-4-6`), `:647` (same pair), `README.md:151`, `:305`, and `CLAUDE.md:84`. Suggested replacements from the current docs list: `anthropic/claude-sonnet-5-5`, `openai/gpt-6-sol`.
- The `list_models` description says it "Returns Sonar models". The live catalog has exactly one Perplexity first-party chat model, `perplexity/sonar`. The `sonar-pro`/`sonar-reasoning-pro`/`sonar-deep-research` IDs aren't in `/v1/models`, which is described as "the models available for the Agent API". Reword it.
- Docs list Gemini 4 Argon/Carbon (intro pricing until 2026-11-30), Claude Fable 5.2 (*"requires non-ZDR access"*), Haiku 5.5 (higher rate above 100k input), GPT-6.1 Sol/Terra, GPT-6 Astra, DeepSeek V4 Pro, Nemotron 3.5 Super (replaces `nemotron-3-ultra-550b-a55b`), GLM 5.3/5.3 Flash, and Grok 4.7. No code change is needed because discovery is dynamic.

### Step 13 (docs): `agent_files` description

Docs now name the mechanism: sandbox files are those *"delivered with the `share_file` tool"*, and they appear as a `share_file` output item. Our description and CLAUDE.md attribute this to the "registered artifact path (`/mnt/data`)". That's consistent with what we observed, but the documented contract is `share_file`, so reword. No pagination or retention is documented for `GET /v1/agent/{id}/files`. The cancel endpoint is unchanged (`POST /v1/agent/{id}/cancel`, returns `cancelling`, 400 if already terminal, 404 if unknown).

### Step 14 (new tools, by value)

| Product | Endpoint(s) | Verdict |
|---|---|---|
| **Decisions API** (Oct, updated Nov) | `POST /v1/decisions`. `model` (`pplx-decider-v1.2`, `pplx-decider-flash-v1.2`, `-latest` aliases), `state` (string/object/array, images as `image_url` parts), `questions` (named map of `noul`/`choice`/`score`), `mode:"web_grounding"` (≤100 questions, $0.001 per search/fetch), `max_staleness`. Unknown fields → 400. SDK `client.decisions.create`, but *"The Python library and TypeScript SDK lack a `mode` parameter, so send it in the request body"*. | **Recommend a new `decisions` tool.** Cheap ($0.01-0.02 per M input, free output), and genuinely useful to an LLM caller (probabilistic gating and classification with web grounding). M effort. |
| **Batch API + Files API** (SDK 0.40.0) | `POST/GET/DELETE /v1/files` (`purpose=batch`, 30-day retention), `POST /v1/batches` (`input_file_id`, `endpoint:"/v1/responses"`, `completion_window:"24h"`, `metadata`), get/list/cancel. Limits: 50k lines, 200 MB per file. No separate price; OpenAI models run on `flex`. Rejects `function`/`connector`/`advisor` tools and streaming. | Possible `agent_batch` tool, but it needs a JSONL upload and the MCP caller would have to build that file. L effort, low fit for an interactive MCP. **Defer.** |
| **Skills management** (SDK 0.39.0) | `/v1/skills` CRUD, revisions, download; ZIP upload with one `SKILL.md`, 32 MiB, 500 per project, optimistic concurrency via `expected_revision`. | A read-only `list_skills` (list/get) is S effort and helps callers discover `skill_...` IDs for Step 9. Write ops need multipart ZIPs. **Defer.** |
| Orchestrator API (formerly Router/Gateway) | `/orchestrator/v1/{chat/completions,responses,messages,models}` | Separate product, out of scope (the 2026-08 note reached the same call). |
| Analytics API (Nov update), Audit API | `/v1/admin/audit-events` (dedicated audit key; a normal key gets 403); credit-usage endpoints | Admin keys, not our key type. Out of scope. |
| Browser sessions | SDK only: `client.browser.sessions.create/delete` | No docs page found. Unverified, skip. |
| Safety identifier | `Perplexity-Safety-Identifier` header (documented on the orchestrator example only) | Not documented for the Agent API. Skip. |

---

## Documentation Sources

| Source | URL |
|---|---|
| Changelog (Sep-Nov 2026 entries) | https://docs.perplexity.ai/docs/resources/changelog |
| Agent API reference (create) | https://docs.perplexity.ai/api-reference/agent-post |
| Agent API reference (retrieve) | https://docs.perplexity.ai/api-reference/agent-get |
| Agent files list reference | https://docs.perplexity.ai/api-reference/agent-files-get |
| Effort levels | https://docs.perplexity.ai/docs/agent-api/effort |
| Background mode | https://docs.perplexity.ai/docs/agent-api/background-mode |
| MCP tool (require_approval) | https://docs.perplexity.ai/docs/agent-api/tools/mcp |
| Connectors | https://docs.perplexity.ai/docs/agent-api/tools/connectors |
| Image Search tool | https://docs.perplexity.ai/docs/agent-api/tools/image-search |
| Web Search tool | https://docs.perplexity.ai/docs/agent-api/tools/web-search |
| Working with files (input_file, share_file) | https://docs.perplexity.ai/docs/agent-api/working-with-files |
| Skills (builtin/inline/custom + management) | https://docs.perplexity.ai/docs/agent-api/skills |
| Profiles | https://docs.perplexity.ai/docs/agent-api/profiles |
| Batch API | https://docs.perplexity.ai/docs/agent-api/batch |
| Agent models + service tiers | https://docs.perplexity.ai/docs/agent-api/models |
| Models list reference | https://docs.perplexity.ai/api-reference/models-get |
| Embeddings reference | https://docs.perplexity.ai/api-reference/embeddings-post |
| Contextualized embeddings reference | https://docs.perplexity.ai/api-reference/contextualized-embeddings-post |
| Decisions API reference | https://docs.perplexity.ai/api-reference/decisions-post |
| Safety identifiers | https://docs.perplexity.ai/docs/admin/safety-identifiers |
| Audit API | https://docs.perplexity.ai/docs/admin/audit-api |
| SDK CHANGELOG (0.38.4 → 0.41.0) | https://github.com/perplexityai/perplexity-node/blob/main/CHANGELOG.md |
| SDK 0.41.0 generated types | https://unpkg.com/@perplexity-ai/perplexity_ai@0.41.0/dist/generated/api.d.ts |
| SDK 0.41.0 resource exports | https://unpkg.com/@perplexity-ai/perplexity_ai@0.41.0/dist/resources/index.d.ts |
| Live `GET /v1/models` | via this repo's `list_models` tool, 2026-11-12 (empirical) |

## Conflicts and resolutions

1. **`preset` present vs. absent.** The formal reference dropped it, the SDK marks it `@deprecated`, and the live API accepts it. Resolution: deprecated but working (empirical). Migrate to `effort` and keep an alias.
2. **`reasoning.effort` values.** The API reference lists `minimal|low|medium|high|xhigh|max`. The SDK 0.41.0 lists `none|minimal|low|medium|high|xhigh` (has `none`, lacks `max`). The August changelog says the `fast` preset runs "with reasoning effort set to `none`". `max` was verified live on 2026-08-24. `none` is **unverified**, and our enum and validation would reject it. Add a `validate-params.mjs` probe for `reasoning.effort:"none"` before adding it to `VALID_AGENT_REASONING_EFFORT`.
3. **`ultra` / `ultra-preview` / `wide-research`.** The October changelog removed the undocumented `ultra` and added `ultra-preview`. November re-added `ultra` as a documented level. The effort page lists only fast through ultra. `wide-research` still works empirically and maps to the xhigh model. Resolution: document `ultra` and treat `wide-research` as a legacy alias. `ultra-preview` is ambiguous, so don't advertise it.
4. **OpenAI retirement of 2026-10-24 vs. reality.** The changelog announced it, but `/v1/models` still lists the IDs and `openai/gpt-5` still serves (empirical, 2026-11-12). Resolution: don't rely on these IDs. Our `enrichIfModelError` path already handles a future hard rejection.
5. **Stream reconnection params.** The background-mode guide and SDK types have `stream`/`starting_after` on retrieve, but the formal `agent-get` reference lists none. Not material, since we don't stream.
6. **`service_tier`/`prompt_cache_key` are still absent from the formal `/agent-post` list**, but are typed in the SDK and documented on the models page. Keep them as loose passthroughs.
7. **`advisor` tool.** The Batch page says it rejects "`function`, `connector`, and `advisor` tools". No `advisor` tool appears in the `/agent-post` tool list (9 types). It's single-sourced and undocumented, so ignore it.

## Best practices and potential issues

- **Combining `profile` with the default effort injection will break profile calls.** Gate the default on `!model && !models && !effort && !preset && !profile`.
- **`require_approval` only helps if the caller can see `mcp_approval_request`.** Ship Step 5's rendering together with Step 7.
- Approval continuation must **resend the identical `tools`**, because the API doesn't carry them over from `previous_response_id`. The tool description should say so.
- Custom connectors keep secrets out of our request body. Prefer recommending them over `mcp_servers.authorization` where possible.
- Since October every effort level uses Fast Search by default. If a caller wants standard (deeper) search, they now need `web_search.search_type:"web"`, which we can't express until Step 6 lands.
- Automatic output-token limits (November): `max_output_tokens` is now optional for all models, including Anthropic (each generation is capped at 128k or the model's limit). No action is needed, but our description could say so.
- The `xhigh` output budget is 512k and `max_steps` is 300. Background mode is strongly advisable for `xhigh`/`ultra`.

## Project-specific adaptations

Files to touch: `src/schemas/types.ts` (`AgentArgs`: `effort`, `profile`, `tool_choice`, `connectors`, `approval_responses`, `files`, `web_search_options`; `AgentMcpServer.require_approval`; `AgentSkill.type` += `custom` with `id`/`version`; `VALID_AGENT_TOOLS` += `image_search`; `VALID_AGENT_PRESETS` → effort names), `src/schemas/toolSchemas.ts`, `src/schemas/validation.ts`, `src/services/PerplexityApiService.ts` (`agentRespond`, `listModels`), `src/handlers/AgentHandler.ts` (renderer, error hint), `README.md`, `CLAUDE.md` (the max_steps 100 line, the "no typed models resource" line, the preset-naming lines, the /mnt/data line), and `scripts/validate-params.mjs` (new probes: `effort`, pinned effort, `reasoning.effort:"none"`, `image_search`, `input_file`, `require_approval`, `service_tier:"flex"`).

**Tool log**: none (no Parallel calls).

## 2026-11-12: Follow-up on the Sonar end of support: mapping Sonar onto the Agent API, and whether background mode can replace `async_research`

**Shape**: engineering plan (addendum)

### `effort` field shape (confirming Step 1)

- The request field is top-level `effort: string`. It is not an enum. Accepted forms are `name`, `name@latest` and `name@<version>`, for example `low@2026-11-11.0`. The current names are `fast`, `low`, `medium`, `high`, `xhigh` and `ultra`. `wide-research` still works but now resolves to the xhigh setup (verified live). An unknown name or version returns 400. `effort` is required when `model` is absent, and it can't be combined with `profile`.
- In the response, `effort` comes back as `name@version` and can be sent back to pin that exact version. The response's `preset` is `@deprecated` and carries the same value.
- `preset` is a deprecated alias. In SDK 0.41.0: "If both are supplied, effort takes precedence when non-null." The formal reference no longer lists `preset`, but live calls with it still work as of today.
- **`reasoning.effort` is a different field.** Top-level `effort` picks the configuration bundle: model, tools, steps, prompt and search type. `reasoning: {effort}` sets how hard the chosen model reasons. Its values are `minimal|low|medium|high|xhigh|max` per the API reference, while SDK 0.41.0 has `none` but not `max`. Both can be sent in the same request.

### End of support (Sonar overview page, [migrate-from-sonar/overview](https://docs.perplexity.ai/docs/agent-api/migrate-from-sonar/overview))

The page says "Sonar Chat Completions support ended on September 27, 2026." Synchronous and streaming requests keep working. They are being reformulated as Agent API requests, rolling out gradually by model. "Asynchronous Sonar requests are not reformulated and are no longer supported." The page recommends moving them to background mode. (A sibling memory note says async still ran in a live probe today. Treat that as borrowed time.)

### Mapping Sonar models to effort levels ([migrate-from-sonar/how-to](https://docs.perplexity.ai/docs/agent-api/migrate-from-sonar/how-to))

| Sonar | Agent effort |
|---|---|
| `sonar` | `fast` |
| `sonar-pro` | `fast` |
| `sonar-reasoning-pro` | `low` |
| `sonar-deep-research` | `high` (the overview suggests `xhigh` for state-of-the-art deep research) |

**This differs from the July mapping recorded in the 2026-08 note**, which was sonar→fast, pro→low, reasoning-pro→medium, deep-research→high. The current pages win. Keep in mind that every level gets cheaper and faster when it runs on Fast Search.

### Mapping parameters: our `search` and `async_research` arguments onto the Agent API (how-to page)

- **Direct equivalents.** These go into a `web_search` tool entry: `search_domain_filter`, `search_recency_filter`, the date filters and the `last_updated_*` filters (all under `filters`), plus `user_location`. Our `max_tokens` becomes `max_output_tokens`. Our `reasoning_effort` becomes `reasoning.effort`. `stream` and `response_format` (json_schema) are unchanged.
- **Partial equivalents.**
  - `search_context_size` becomes `web_search.max_tokens` / `max_tokens_per_page`. There are no named sizes.
  - `search_type` fast/pro becomes the `fast`/`low` effort levels. There's no `auto`.
  - `disable_search` means leaving out `web_search`. The effort levels' own tools still apply, and `tools: []` doesn't clear them. The guide mentions a `max_tool_calls: 0` workaround, but **`max_tool_calls` isn't in the formal `/agent-post` body list**. Verify it before relying on it.
  - `return_images` becomes the `image_search` tool. `image_domain_filter` and `image_format_filter` become `image_search.filters.domain_filter` and `format_filter`.
  - `return_related_questions` has no field. Prompt for them or use a structured-output schema.
  - `search_mode: academic` has no equivalent; use domain filters. `search_mode: sec` becomes `finance_search` or SEC domain filters.
  - `enable_search_classifier` means letting the model decide whether to call the tool.
- **Dropped.** `search_language_filter`, `stream_mode: full`, `image_results_enhanced_relevance`, and the video options. `language_preference` isn't covered by the guide, but it is an Agent API top-level field, so carry it over directly. `temperature` and `top_p` are silently ignored for GPT-5, o1 and o3 models.
- **Response shape.**
  - `output_text` replaces `choices[0].message.content`.
  - Sources come in a `search_results` output item. Inline markers are `[1]` on `fast` and `[web:1]` on `low` and higher.
  - Images come in `image_search_results`.
  - `usage` changes to `input_tokens`/`output_tokens`/`total_tokens` plus `cost.{input_cost,output_cost,total_cost}` (from the agent-get reference). That's not the Sonar `UsageCost` shape, so `responseFormatting.ts`'s cost footer would need an agent variant.

### Can background mode plus `agent_retrieve` replace `async_research`?

- **Submit and status: yes.** `agent({background:true, effort:"high"})` gives you an id, and `agent_retrieve` polls it. Statuses are `queued`/`in_progress` (with a `paused` object while a run waits on a token limit), ending in `completed`/`failed`/`incomplete`/`cancelled`. `agent_cancel` exists already, which `async_research` never had. SDK 0.41.0's `retrieve()` also takes `format: "default"|"short"`, `stream` and `starting_after`. The `format` option is new and not in the formal reference, so it's unverified.
- **List: no.** Neither the API reference nor SDK 0.41.0 has an endpoint to list responses. The Agent API reference covers only get, cancel, files list and file content. `ResponsesResource` has only `create`, `retrieve` and `cancel`; the one `list()` belongs to `responses.files`. So `async_research action:"list"` has no Agent API equivalent. The caller has to keep the ids (and `store: false` runs can't be retrieved at all).
- **Retention:** neither page states a TTL for background responses. Async jobs had 7 days. The working-with-files page mentions retention of "up to 30 days" for inline documents through a continuation chain, which suggests responses last at least that long, but that's an inference.

**Recommendation:** rewrite the `async_research` submit/status actions as thin wrappers over `agentRespond({background:true, effort: map(model)})` and `getAgentResponse()`, using the mapping table above. Give its `reasoning_effort` the same meaning it has on the agent tool. Make `list` return a clear "not supported by the Agent API, keep your response ids" message; the other option is a small per-process registry of the ids we submitted, which wouldn't survive a restart. Mark the tool deprecated in favour of `agent` with `background:true`. If removing the tool isn't wanted, keep it as an alias.
