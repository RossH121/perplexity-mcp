# Perplexity MCP Server

An MCP server that gives Claude (and any other MCP client) access to Perplexity: AI-synthesized web search, raw ranked results, the multi-step Agent API, background research jobs, the Decisions API and embeddings. It exposes 22 tools; 6 of them are deprecated and kept for compatibility.

<a href="https://glama.ai/mcp/servers/6qmvjay9z5">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/6qmvjay9z5/badge" alt="Perplexity Server MCP server" />
</a>

> **Sonar end of support.** Perplexity's Sonar Chat Completions API reached end of support on **2026-09-27**. `search` and `async_research_submit` now run on the Perplexity Agent API by default. See [How `search` works](#how-search-works) and [Migration and breaking changes](#migration-and-breaking-changes).

## Contents

- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Configuration](#configuration)
- [Tools](#tools)
- [How `search` works](#how-search-works)
- [Migration and breaking changes](#migration-and-breaking-changes)
- [Development](#development)

## Prerequisites

- Node.js 20 or newer (`engines` in `package.json`; required by MCP SDK v2)
- A Perplexity API key from <https://www.perplexity.ai/settings/api>
- An MCP client: Claude Code, Claude Desktop, or any other

## Setup

Clone, install and build:

```bash
git clone https://github.com/RossH121/perplexity-mcp.git
cd perplexity-mcp
npm install
npm run build
```

### Claude Code

Add it with the CLI (use `--scope project` to write a shared `.mcp.json` instead of your user config):

```bash
claude mcp add perplexity -e PERPLEXITY_API_KEY=your-api-key -- node /absolute/path/to/perplexity-mcp/build/index.js
```

Or add it to `.mcp.json` in your project root. Claude Code expands `${VAR}` references, so the key can stay in your shell environment:

```json
{
  "mcpServers": {
    "perplexity": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/perplexity-mcp/build/index.js"],
      "env": {
        "PERPLEXITY_API_KEY": "${PERPLEXITY_API_KEY}"
      }
    }
  }
}
```

Tools then appear as `mcp__perplexity__search`, `mcp__perplexity__agent`, and so on. If you pin tool names in agent or permission allowlists, see the [renamed tools](#renamed-and-deprecated-tools).

### Claude Desktop

Add the same entry under `mcpServers` in `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows), with the key written in directly, then restart Claude Desktop.

### Install via MCPB (Claude Desktop, macOS/Windows)

Build the bundle (requires Node.js 20+):

```bash
npm install
npm run pack:mcpb   # -> dist/mcpb/perplexity-mcp-<version>.mcpb
```

To install it, double-click the `.mcpb` file or drag it onto Claude Desktop (Settings > Extensions). Claude Desktop then asks for these settings:

| Setting | Env var | Default | Notes |
|---|---|---|---|
| Perplexity API key (required) | `PERPLEXITY_API_KEY` | none | Stored in the OS keychain |
| Default Sonar model | `PERPLEXITY_MODEL` | `sonar-pro` | `sonar`, `sonar-pro`, `sonar-reasoning-pro` or `sonar-deep-research`. An invalid value stops the server from starting |
| Search backend | `PERPLEXITY_SEARCH_BACKEND` | `agent` | `agent` (Agent API) or `sonar` (legacy Sonar path) |
| Debug logging | `PERPLEXITY_MCP_DEBUG` | empty | Set to `1` for verbose stderr diagnostics |

Claude Desktop isn't available on Linux. There, use the [Claude Code](#claude-code) `.mcp.json` setup, pointing `node` at `build/index.js`.

## Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `PERPLEXITY_API_KEY` | yes | | Your Perplexity API key. The server exits at startup without it. |
| `PERPLEXITY_MODEL` | no | `sonar-pro` | Default Sonar model for `search` when no routing keyword matches: `sonar`, `sonar-pro`, `sonar-reasoning-pro` or `sonar-deep-research`. Any other value is rejected at startup. |
| `PERPLEXITY_SEARCH_BACKEND` | no | `agent` | Backend for `search` and `async_research_submit`. `agent` uses the Agent API. `sonar` switches back to the legacy Sonar Chat Completions and async endpoints, for as long as Perplexity still answers them. Read on every call. |
| `PERPLEXITY_MCP_DEBUG` | no | unset | Any non-empty value turns on verbose diagnostics on stderr. stdout carries only MCP JSON-RPC. |

Pricing: <https://docs.perplexity.ai/docs/getting-started/pricing>

## Tools

### At a glance

| Purpose | Tool | Billed | Notes |
|---|---|---|---|
| **Answer a question** | `search` | yes | One AI-synthesized answer with cited sources. The default choice. |
| **Find sources** | `raw_search` | yes | Ranked URLs, titles and snippets with no LLM. Up to 5 queries per call. |
| **Multi-step agent** | `agent` | yes | Agent API loop: built-in tools, remote MCP servers, skills, file and image input, third-party models. |
| | `agent_retrieve` | | Poll a background `agent` run. |
| | `agent_cancel` | | Cancel an in-progress run. |
| | `agent_files` | | List or download files a run shared. |
| **Background research** | `async_research_submit` | yes | Start a long research job and get an id back. |
| | `async_research_status` | | Poll a job. Returns the report when done. |
| | `async_research_list` | | Jobs submitted by this server process. |
| **Probabilities** | `decisions` | yes | Calibrated yes/no, choice and rubric-score probabilities. |
| **Embeddings** | `embeddings` | yes | Text embeddings. |
| | `contextualized_embeddings` | yes | Chunk embeddings that share per-document context. |
| **Discovery** | `list_models` | | Model ids usable by `agent`. |
| | `list_skills` | | Custom skill ids usable by `agent`. |
| **Search model state** | `get_model_info` | local | Current Sonar model selection for `search`. |
| | `set_model` | local | Pin a model for later `search` calls, or `auto`. |
| **Deprecated** | `async_research` | yes (submit) | Alias, removed next release. Use `async_research_submit` / `_status` / `_list`. |
| | `model_info` | local | Alias, removed next release. Use `get_model_info` / `set_model`. |
| | `domain_filter` | local | Use the per-call `search_domain_filter` on `search`. |
| | `recency_filter` | local | Use the per-call `recency` or date params on `search`. |
| | `clear_filters` | local | Only clears the deprecated stateful filters. |
| | `list_filters` | local | Only lists the deprecated stateful filters. |

"local" tools change or read this server's in-memory state and make no API call. Unbilled tools without "local" read existing results from the API.

Every tool is annotated with MCP read-only, destructive, idempotent and open-world hints, so clients such as Claude Code can run the read-only ones in parallel and retry them safely. Data tools also return `structuredContent` matching a declared `outputSchema`, alongside the markdown text: `search`, `raw_search`, `agent`, `agent_retrieve`, `agent_files`, `async_research_status`, `async_research_list`, `get_model_info`, `list_models`, `list_filters`, `list_skills`, `decisions`, `embeddings` and `contextualized_embeddings`.

### `search`

Returns one synthesized answer with numbered sources. It uses only the query text, not your conversation, so write a specific query. Keyword routing picks the depth (see [How `search` works](#how-search-works)).

| Parameter | Options | Description |
|---|---|---|
| `query` | string | The question. Required. |
| `effort` | `fast` / `low` / `medium` / `high` / `xhigh` / `ultra`, or `name@latest` / `name@<version>` | Agent effort level for this call. Bypasses keyword routing and `set_model`. Agent backend only. `high` and above can take minutes. |
| `search_domain_filter` | string[], max 20 | Allow only these domains, or exclude them with a `-` prefix (`["-pinterest.com"]`). A list is all-allow or all-exclude. `[]` means no domain filter for this call. |
| `recency` | `hour` / `day` / `week` / `month` / `year` | Time window for this call. Dropped, with a note, if `search_after_date` / `search_before_date` is also set. |
| `search_after_date` / `search_before_date` | `MM/DD/YYYY` | Published-date filter |
| `last_updated_after` / `last_updated_before` | `MM/DD/YYYY` | Last-updated filter |
| `search_mode` | `web` / `academic` / `sec` | `academic` becomes an allowlist of 20 academic domains, unless you set domain filters. `sec` adds the `finance_search` tool and a `sec.gov` filter. |
| `search_context_size` | `low` / `medium` / `high` | How much retrieved context the model gets |
| `search_type` | `fast` / `pro` / `auto` | `fast` uses fast web search. `pro` raises effort `fast` to `low`. `auto` has no Agent equivalent and is ignored. |
| `reasoning_effort` | `minimal` / `low` / `medium` / `high` | Sent as `reasoning.effort` |
| `return_images` | boolean | Adds the `image_search` tool and an `## Images` section. Billed per image search. |
| `image_domain_filter` / `image_format_filter` | string[] | Restrict images (first 10 domains; bmp, gif, jpeg, png, webp, svg) |
| `country` / `city` / `region` / `latitude` / `longitude` | | Localize results |
| `language_preference` | ISO 639-1 | Response language |
| `disable_search` | boolean | Answer with `perplexity/sonar` and no tools. Filters don't apply. |
| `response_format` | JSON schema | Structured output |
| `temperature` / `top_p` / `max_tokens` | number | Sampling and length controls (`max_tokens` is sent as `max_output_tokens`) |
| `show_cost` | boolean | Append a request-cost footer |
| `strip_thinking` | boolean | Remove `<think>` blocks (only the legacy backend produces them) |
| `stream` | boolean | Legacy backend only. The result is the same either way. |
| `search_language_filter`, `stream_mode`, `return_related_questions`, `image_results_enhanced_relevance`, `enable_search_classifier`, `stop` | | Legacy Sonar backend only. Ignored on the agent backend, with a line under "Backend notes". |

Examples:

- *"What's the latest Node.js LTS?"* routes to `sonar-pro`, effort `fast`.
- *"Deep research analysis of CRISPR gene editing advances"* routes to `sonar-deep-research`, effort `high`.
- `search { query: "...", effort: "medium", search_domain_filter: ["nodejs.org"] }` sets the depth and sources directly.

### `raw_search`

Ranked results straight from the Search API, with no LLM. Cheaper and faster than `search`. Useful for URL discovery, source lists and fact-checking pipelines.

| Parameter | Options | Description |
|---|---|---|
| `query` | string or up to 5 strings | Each query counts separately against the rate limit. |
| `max_results` | 1-20, or 1-50 with `search_type: people` | Default 10 |
| `max_tokens` / `max_tokens_per_page` | number | Content budget overall and per result |
| `search_context_size` | `low` / `medium` / `high` | Content extracted per page (default `high`). Undocumented but still effective; prefer the token budgets. |
| `search_type` | `web` / `fast` / `people` | `fast` is cheaper and lower-latency. `people` routes to People Search. |
| `search_domain_filter` | string[], max 20 | Allow, or exclude with `-` |
| `recency`, `search_after_date` / `search_before_date`, `last_updated_after` / `last_updated_before` | | Time filters |
| `search_language_filter` | `["en","de"]` | Source languages |
| `country` | ISO 3166-1 alpha-2 | Localize results |

`raw_search` has no `search_mode`: the `/search` endpoint rejects it. To narrow it to a corpus, use `search_domain_filter`, for example `["arxiv.org", "pubmed.ncbi.nlm.nih.gov"]` or `["sec.gov"]`.

### `agent`

The Perplexity Agent API: a multi-step loop that can call built-in tools, remote MCP servers and skills, and can run third-party models. With no `effort`, `model` or `profile`, it runs effort `low`.

| Parameter | Options | Description |
|---|---|---|
| `input` | string | The task. Required. May be empty only with `approval_responses`. |
| `effort` | `fast` / `low` / `medium` / `high` / `xhigh` / `ultra`, or `name@latest` / `name@<version>` (e.g. `low@2026-11-11.0`) | A configuration bundle (model, tools, steps, search type). Default `low`. `wide-research` is a legacy alias of `xhigh`. Can't be combined with `profile`. |
| `preset` | | Deprecated alias of `effort`. `effort` wins if both are set. |
| `profile` | `{type:"custom", id, version?}` | A saved configuration from the API Portal. Request fields override it, except `tools`, which merge per tool. |
| `model` / `models` | e.g. `anthropic/claude-sonnet-5-5`, `openai/gpt-6-sol` | A provider-qualified model, or a fallback chain. Call `list_models` for current ids. An invalid id comes back with the current list in the error. |
| `instructions` | string | System prompt |
| `tools` | `web_search` / `fetch_url` / `people_search` / `finance_search` / `image_search` / `sandbox` | Built-in tools |
| `web_search_options` | object | `search_type` (`fast` default, or `web`), `max_results` (1-50), token budgets, `search_context_size`, domain/recency/date filters, `user_location`. Setting it enables `web_search`. |
| `tool_choice` | `none` / `auto` / `required` | Whether the model may, must or must not call tools |
| `max_steps` | 1-500 | Agentic steps. A direct `model` run defaults to 1. |
| `max_output_tokens` | number | Output cap |
| `reasoning_effort` | `none` / `minimal` / `low` / `medium` / `high` / `xhigh` / `max` | How hard the model reasons. Separate from `effort`. |
| `response_format` | JSON schema | Structured output |
| `images` | string[] | `http(s)://` or `data:` image URLs |
| `files` | `[{file_url \| file_data, filename?}]` | PDF, DOC, DOCX, TXT or RTF input, max 30. Not available to ZDR organizations. |
| `mcp_servers` | object[] | Remote MCP servers (see below) |
| `approval_responses` | `[{approval_request_id, approve, reason?}]` | Answer approval-gated MCP calls. Needs `previous_response_id` and the same `mcp_servers`. |
| `skills` | object[], max 16 | `builtin`, `inline` or `custom` (see below) |
| `background` | boolean | Queue the run. Poll with `agent_retrieve`, cancel with `agent_cancel`. Use it for `xhigh` / `ultra`. |
| `previous_response_id` / `store` | | Continue a prior run. `store: false` hides the run from `agent_retrieve`. |
| `language_preference`, `temperature`, `top_p` | | Response language and sampling |
| `service_tier` | `auto` / `default` / `flex` / `priority` / `fast` | `flex` is best effort at 0.5x (OpenAI models). `priority` (alias `fast`) costs **2x**. The output header shows the tier that ran. |
| `prompt_cache_key` | string | Override the automatic prompt cache key |

The output header reads `[Agent model: X | effort: name@version | service_tier: Y]`. Approval requests, MCP activity, images and shared files get their own sections.

**Remote MCP servers.** Streamable HTTP endpoints only (no SSE):

```json
{
  "server_label": "docs",
  "server_url": "https://example.com/mcp",
  "authorization": "<bearer token>",
  "allowed_tools": ["search_docs"],
  "require_approval": "always"
}
```

By default every MCP call runs automatically. `require_approval` takes `always`, `never`, or `{always?, never?: {tool_names?, read_only?}}`. A gated call pauses the run and is listed with an `approval_request_id`. To continue, call `agent` again with `previous_response_id`, `approval_responses` and the same `mcp_servers`. A single unreachable server fails the whole run with HTTP 424, so configure only servers you trust and expect to be up.

**Skills.** Selecting any skill enables the sandbox:

```json
{ "type": "builtin", "name": "office/pdf" }
{ "type": "inline", "name": "house-style", "description": "Our formatting rules.", "instructions": "..." }
{ "type": "custom", "id": "skill_..." }
```

Builtin names are `office` (all four), `office/docx`, `office/pdf`, `office/pptx` and `office/xlsx`. Use `list_skills` to find custom ids.

### `agent_retrieve`, `agent_cancel`

`agent_retrieve { response_id }` returns a background run's status, and its full output once it completes. `agent_cancel { response_id }` stops a run. Cancellation is asynchronous, so poll `agent_retrieve` to see the final status.

### `agent_files`

Lists (`action: "list"`) or downloads (`action: "content"`, with `file_id`) the files a run delivered with its `share_file` tool. The `office/*` skills do this, and such files also appear under "Shared files" in the agent output. Files the agent merely wrote to disk during code execution are not listed, so ask it to share the file.

```
agent_files { action: "list", response_id: "resp_..." }
agent_files { action: "content", response_id: "resp_...", file_id: "file_..." }
```

Shared files are also MCP resources at `perplexity-agent-file://{response_id}/{file_id}`. `list` returns resource links; `content` (or `resources/read`) returns the bytes as an embedded resource, as `text` for UTF-8 text types and as a base64 `blob` otherwise. Files over 5 MB are reported, not inlined. `resources/list` shows the files seen in the current session.

### `async_research_submit`, `async_research_status`, `async_research_list`

Long research as a background Agent API run, so the call doesn't block.

| Tool | Parameters | Description |
|---|---|---|
| `async_research_submit` | `query`, `model`, `reasoning_effort`, `search_mode` | Returns a `resp_...` id. `model` is a Sonar model mapped to an effort level (default `sonar-deep-research`, which maps to `high`). |
| `async_research_status` | `request_id`, `strip_thinking` | Read-only. Says "not ready yet" until the run completes. Bare-UUID ids from the old async Sonar API are still polled through the legacy endpoint while it answers. |
| `async_research_list` | | Ids submitted by this server process (kept in memory, lost on restart), plus any legacy async jobs. |

The id also works with `agent_retrieve` and `agent_cancel`. For full control (tools, models, structured output), use `agent` with `background: true`.

### `decisions`

Ask named questions about some content and get calibrated probabilities back instead of prose. No rationale text is returned.

| Parameter | Options | Description |
|---|---|---|
| `state` | string / object / array | The content the questions refer to. It may embed OpenAI-style `image_url` parts with base64 data URLs, up to 8 per question. |
| `questions` | object | Name → `{type, instructions?, criteria?}`. `noul`: yes/no, returns P(yes); needs `instructions` or `criteria: {true, false}`. `choice`: `criteria` maps each option to a description or null (1-255 options). `score`: `criteria` is an ordered array of 1-10 levels (index = score). |
| `model` | string | Default `pplx-decider-latest` (v1.2, 27B). `pplx-decider-flash-latest` (4B) is half price. |
| `mode` | `web_grounding` | One web search per question (max 100 questions). A URL-only `state` is fetched first. Sources are listed. |
| `max_staleness` | integer (seconds) | Max age of the fetched page copy (web grounding with a URL state only) |

Pricing: $0.02 per million input tokens ($0.01 for flash), output free, plus $0.001 per web search or fetch. The output shows an estimated cost, because the API returns token counts but no cost.

```
decisions({
  state: "The headphones sound great, but the battery stopped charging after two weeks.",
  questions: {
    defect:    { type: "noul",   instructions: "Does the review report a product defect?" },
    sentiment: { type: "choice", criteria: { positive: "Mostly satisfied", mixed: null, negative: "Mostly dissatisfied" } },
    severity:  { type: "score",  instructions: "How severe?", criteria: ["Cosmetic", "Inconvenient", "Unusable"] }
  }
})
```

### `embeddings`, `contextualized_embeddings`

| Parameter | `embeddings` | `contextualized_embeddings` |
|---|---|---|
| `input` | string or string[] (max 512) | string[][]: one array of chunks per document (max 512 documents, 16,000 chunks) |
| `model` | `pplx-embed-v1-0.6b` (default) / `pplx-embed-v1-4b` | `pplx-embed-context-v1-0.6b` (default) / `pplx-embed-context-v1-4b` |
| `dimensions` | 128-1024 (0.6b) or 128-2560 (4b) | same |
| `encoding_format` | `base64_int8` (default; there is no float output) / `base64_binary` | same |
| `full` | Include the raw base64 vectors (default: summary only) | same |

The two model families are not interchangeable. Contextualized embeddings let chunks from the same document share context, which improves RAG retrieval.

### `list_models`, `list_skills`

`list_models { provider? }` lists the models available to your account from the live `GET /v1/models` endpoint, grouped by provider. These are the provider-qualified ids for `agent`'s `model` / `models` (e.g. `anthropic/claude-sonnet-5-5`, `openai/gpt-6-sol`, `perplexity/sonar`). It doesn't list the Sonar models `search` routes between; `get_model_info` shows those.

`list_skills` lists your project's uploaded custom skills (`limit`, `page_token`), or describes one by `skill_id` (with an optional `revision`). Pass the id to `agent` as `skills: [{ type: "custom", id }]`. Uploading and deleting skills are not exposed.

### `get_model_info`, `set_model`

`get_model_info` shows the current Sonar selection for `search`, the default model and the routing keywords. `set_model { model }` pins `sonar`, `sonar-pro`, `sonar-reasoning-pro` or `sonar-deep-research` for every later `search` call in this server process, or `"auto"` restores keyword routing. A query that strongly matches another model's keywords still overrides a pinned model. For a single call, use `search`'s `effort` instead, which doesn't touch shared state.

### Deprecated tools

These still work. Each alias's result ends with a deprecation note.

| Tool | Replacement | Status |
|---|---|---|
| `async_research` (`action`: `submit` / `status` / `list`) | `async_research_submit` / `async_research_status` / `async_research_list` | Removed next release |
| `model_info` | `get_model_info` (view) / `set_model` (change). Called with no arguments, `model_info` resets the selection. | Removed next release |
| `domain_filter`, `recency_filter` | `search`'s per-call `search_domain_filter`, `recency` and date params | Deprecated, no removal date |
| `clear_filters`, `list_filters` | Not needed with per-call params | Deprecated, no removal date |

The stateful filters apply to every later `search` in the server process, including parallel ones. Per-call params override them for that call without changing them.

## How `search` works

`search` and `async_research_submit` run on the Perplexity Agent API unless `PERPLEXITY_SEARCH_BACKEND=sonar`.

1. **Routing.** Keywords in the query pick a Sonar model, unless `set_model` pinned one.
2. **Effort mapping.** That model maps to an Agent effort level, following Perplexity's [Sonar migration guide](https://docs.perplexity.ai/docs/agent-api/migrate-from-sonar/how-to):

| Keywords (examples) | Sonar model | Agent effort |
|---|---|---|
| `deep research`, `comprehensive`, `thorough`, `in-depth`, `expert` | `sonar-deep-research` | `high` |
| `reasoning`, `solve`, `analyze`, `think`, `figure out`, `logic` | `sonar-reasoning-pro` | `low` |
| `quick`, `simple`, `brief`, `basic`, `short` | `sonar` | `fast` |
| anything else | `sonar-pro` (or `PERPLEXITY_MODEL`) | `fast` |

3. **Override.** A per-call `effort` skips both steps.
4. **Request.** Filters, location and `search_context_size` go on the `web_search` tool. `return_images` adds `image_search`, and `search_mode` becomes domain filters or tools.

The header line shows what ran, for example `[Using model: sonar-pro -> Agent effort fast (ran fast@<version> on <model>) - ...]`, or `[Using effort override: medium (ran ...)]`. Parameters with no Agent equivalent are listed under "Backend notes" at the end of the result.

On a live comparison of six queries (2026-11-12), the agent backend gave equivalent answers at the same latency, cost 2-3x less on text queries, and returned images where the legacy backend returned none. Academic mode is only approximated: it returned 10 sources to Sonar's 20.

**Rollback.** `PERPLEXITY_SEARCH_BACKEND=sonar` restores the legacy Sonar Chat Completions and async paths for as long as Perplexity still answers them. On that backend `effort` is ignored, the Sonar-only params work again, and `async_research_submit` accepts only `sonar-deep-research`. Legacy Sonar docs: <https://docs.perplexity.ai/docs/legacy/sonar/>.

## Migration and breaking changes

### Renamed and deprecated tools

- New tools: `async_research_submit`, `async_research_status`, `async_research_list`, `get_model_info`, `set_model`, `decisions`, `list_skills`.
- `async_research` and `model_info` are deprecated aliases, removed in the next release. Their results end with a deprecation note.
- `domain_filter`, `recency_filter`, `clear_filters` and `list_filters` are deprecated in favour of per-call params.
- Clients that pin an exact tool list (for example a `.claude/agents/*.md` allowlist containing `mcp__perplexity__model_info`) need the new names added.
- `set_model` requires `model`; pass `"auto"` to reset. Under `model_info`, calling with no arguments reset the selection.

### `search`

- The header line now names the effort level and the version that ran. On the legacy backend it reads `[Using model: X (legacy Sonar backend) - ...]`.
- At effort `low` and above, inline citations look like `[web:N]`. Sources are still numbered `[N]`.
- These params have no effect on the default backend and are reported under "Backend notes": `search_language_filter`, `stream_mode`, `image_results_enhanced_relevance`, `return_related_questions`, `search_type: "auto"`, `stop`, `enable_search_classifier`.
- `return_images` now actually returns images, billed at about $0.0025 per image search.
- `disable_search` answers with `perplexity/sonar`, and the domain, recency and date filters are ignored.
- A recency filter (stateful or per-call) combined with `search_after_date` / `search_before_date` is dropped, with a note.
- A per-call `search_domain_filter` that mixes allow and `-` entries, has more than 20 entries or has empty entries is rejected, as is a malformed `effort`.

### Background research

- `async_research_submit` returns `resp_...` ids, which also work with `agent_retrieve` and `agent_cancel`.
- Status values are lowercase (`queued`, `in_progress`, `completed`, `failed`, `incomplete`, `cancelled`) instead of `COMPLETED` / `FAILED`. The 7-day expiry line is gone.
- `list` shows only runs submitted since the server process started, plus legacy async jobs.
- On the agent backend all four Sonar models are accepted and mapped to an effort level.

### `agent`

- `preset` is replaced by `effort`, which takes the same level names. `preset` still works as an alias, and `effort` wins if both are set. `wide-research` now runs `xhigh`.
- `max_steps` goes up to 500 (was 100).
- The output header now includes the effort version and service tier.

### `raw_search`

- More than 5 queries, empty strings in a query array, and `max_results` over 20 (over 50 for `people`) are now rejected client-side. The API rejected them anyway.

### Embeddings

- Omitting `encoding_format` gives `base64_int8`. There never was a full-precision float output.

### Results

- Data tools return `structuredContent` alongside the text. Clients that validate results against `outputSchema` get typed data.
- `agent_files content` returns `text`, not a base64 `blob`, for UTF-8 text types.
- `resources/read` for an unknown or malformed `perplexity-agent-file://` URI, or one the API answers with 400/404, now returns JSON-RPC error `-32602` (Invalid Params) instead of `-32002`. The message still starts `Resource not found:`.

### Runtime

- The server is built on MCP SDK v2 (`@modelcontextprotocol/server`). Node.js versions before 20 are no longer supported.
- Over stdio it serves both protocol eras: the initialize handshake for 2024-10-07, 2024-11-05, 2025-03-26, 2025-06-18 and 2025-11-25 (Claude Code negotiates 2025-11-25), and the stateless 2026-07-28 era, which starts with `server/discover`. In 2026-07-28, instructions come back on `server/discover`, and resource `list_changed` notifications go out only on a `subscriptions/listen` stream the client opens.
- Install and run commands, the `build/index.js` entrypoint, env vars, tool names and result shapes are unchanged.

## Development

```bash
npm run build   # compile TypeScript to build/
npm start       # run the built server on stdio
npm test        # build, then run the node:test suite (no network)
```

The unit tests use fakes and never call the API. A separate script checks every request parameter against the live API, because the SDK's types are not reliable enough to catch a misnamed field:

```bash
PERPLEXITY_API_KEY=... node scripts/validate-params.mjs                    # cheap checks
PERPLEXITY_API_KEY=... node scripts/validate-params.mjs --include-costly   # adds priority tier, sandbox file round-trip, legacy async submit
```

It prints PASS, FAIL or SKIP per check. Legacy Sonar canaries print OK or LOST, which is informational. The MCP approval round-trip runs against a public server by default; set `PROBE_APPROVAL_MCP_URL=skip` to skip it.

Packaging:

- `npm run pack:mcpb` builds the MCPB bundle into `dist/mcpb/` (gitignored). The script does a production-only install, runs `mcpb validate` and `mcpb pack`, then unpacks the bundle and runs a smoke test.
- `npm run mcpb:manifest` regenerates the `version` and `tools` fields of `manifest.json` from `package.json` and the built server's `tools/list` (`--check` fails if they are stale). Don't hand-edit those two fields.

Source is in `src/`. After editing, rebuild and restart your MCP client to load the changes.

## License

MIT
