---
paths:
  - "src/handlers/Agent*.ts"
  - "src/utils/agentRequest.ts"
  - "src/services/PerplexityApiService.ts"
  - "src/handlers/ModelListHandler.ts"
---

# Agent API (`agent`, `agent_retrieve`, `agent_cancel`, `agent_files`, `list_models`)

Facts verified by live calls on the date shown. The API changes often, so re-verify with `scripts/validate-params.mjs` before relying on an old one.

## Request shape
- `effort` replaced `preset` (Oct 2026; SDK 0.41 marks `preset` deprecated, effort wins when both are set). `agentRespond()` sends only `effort`, mapping `preset` onto it, and injects `effort:"low"` only when none of model/models/effort/preset/profile is given. `effort` is a free string checked loosely by `AGENT_EFFORT_PATTERN`: `fast`/`low`/`medium`/`high`/`xhigh`/`ultra`, or a `name@latest`/`name@<version>` pin. The API returns 400 for unknown ones. `wide-research` is a legacy alias for `xhigh`. The response echoes `effort` as `name@version` (2026-11-12)
- `effort` (agent setup) and `reasoning.effort` (how hard the model thinks) are different fields. `reasoning.effort` accepts both `none` (absent from the API reference) and `max` (absent from the SDK types) (2026-11-12)
- `profile` cannot be combined with `effort`; the API rejects it and so does our validation. The `profile.id` format is unconfirmed: every guess, including the docs' example `profile_8Qw3x7tJm2N6pR4`, got "invalid format" (2026-11-12). Needs a real Portal profile to verify
- `tools` has two shapes: built-in string names and `{type:"mcp", ...}` objects. The MCP schema keeps them as separate params (`tools`, `mcp_servers`) and `agentRespond()` merges them, because MCP clients handle flat enums far better than per-item `oneOf`
- `web_search_options` is flat on the MCP side. `buildWebSearchTool()` is the one web_search builder (also used by `search`): it keeps size and location fields top-level and nests the domain/recency/date filters under `filters`. The API rejects recency combined with published-date filters with a 400 (2026-11-12). Every effort level defaults to `search_type:"fast"` since Oct 2026
- `images` and `files` wrap `input` into one user message with `input_text`/`input_image`/`input_file` parts (`buildAgentInput`). Each `files` entry has exactly one of `file_url` (https) or `file_data` (base64 / data: URI), max 30
- `max_steps` is 1-500 (raised from 100 in Oct 2026; 501 gets a 400). Direct-model runs default to 1 step
- `service_tier`: `auto`/`default`, `flex` (0.5x price), `priority` (2x), `fast` (alias of priority). Unsupported tiers are accepted silently; the response echoes the tier that served. It and `prompt_cache_key` are missing from the formal body list, so they stay loose strings
- Selecting any `skills` entry turns on the sandbox for that request. Custom skills use `{type:"custom", id, version?}`, but the skills API calls versions `revision`; whether one is accepted as the other is unverified
- `mcp_servers[].authorization` is a raw bearer token in the request body. Redact it if request logging is ever added

## MCP servers and approvals
- One unreachable `mcp_servers` entry fails the whole run with HTTP 424
- A run gated by `require_approval` comes back `status:"completed"` with no message, only `mcp_list_tools` + `mcp_approval_request` items. `renderAgentResponse` must list the pending approvals, or the caller sees "(no text output)". To continue, send `previous_response_id` + `approval_responses` + the same `mcp_servers` again, because tools don't carry over. `input` may be empty (2026-11-12, against `https://mcp.deepwiki.com/mcp`)

## Responses and files
- An `incomplete` run carries `incomplete_details.reason` (e.g. `max_output_tokens`). The renderer shows that reason, `error.message` on failed runs, and `paused` on in-progress runs
- `agent_files` only lists files the agent delivered with `share_file`, which the `office/*` skills do. A model that wrote a file by running raw code produced nothing listable (2026-08-24)
- `client.responses.files.content()` returns a raw fetch `Response`, not parsed JSON. Read it with `.arrayBuffer()`, and take the type and filename from the `content-type`/`content-disposition` headers. Inline content is capped at 5MB (`MAX_INLINE_BYTES`) because the whole file is base64-encoded into one JSON-RPC message
- No endpoint lists agent runs, so `async_research_list` keeps an in-memory registry
- `/v1/responses` (what the SDK calls) is a working alias of the canonical `/v1/agent`

## Models
- The `model`/`models` catalog drifts. `openai/gpt-4.1` vanished by 2026-08-24, and on 2026-11-12 models with an announced 2026-10-24 retirement were still listed and served. Take example ids from `list_models`, not memory. `AgentHandler.enrichIfModelError` appends the current valid ids for the rejected provider to a model 400
- `list_models` (`client.models.list()`) lists agent model ids only. The only Perplexity chat entry is `perplexity/sonar`; the other Sonar tiers aren't there
