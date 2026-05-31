# Perplexity MCP Server

An MCP server that provides Perplexity AI web search capabilities to Claude, with automatic model selection, stateful filters, and 10 purpose-built tools.

<a href="https://glama.ai/mcp/servers/6qmvjay9z5">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/6qmvjay9z5/badge" alt="Perplexity Server MCP server" />
</a>

## Prerequisites

- Node.js v20 or higher
- A Perplexity API key — get one at <https://www.perplexity.ai/settings/api>
- Claude Desktop (or any MCP-compatible client)

## Installation

1. Clone this repository:

    ```bash
    git clone https://github.com/RossH121/perplexity-mcp.git
    cd perplexity-mcp
    ```

2. Install dependencies:

    ```bash
    npm install
    ```

3. Build the server:

    ```bash
    npm run build
    ```

## Configuration

Add the server to Claude's config file at `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "perplexity-server": {
      "command": "node",
      "args": ["/absolute/path/to/perplexity-mcp/build/index.js"],
      "env": {
        "PERPLEXITY_API_KEY": "your-api-key-here",
        "PERPLEXITY_MODEL": "sonar-pro"
      }
    }
  }
}
```

Replace `/absolute/path/to` with the actual path to where you cloned the repository.

## Available Models

The server automatically selects the best model based on your query, but you can also set a default via `PERPLEXITY_MODEL`:

| Model | Best for |
|---|---|
| `sonar-deep-research` | Comprehensive reports, exhaustive multi-source research |
| `sonar-reasoning-pro` | Complex logic, math, chain-of-thought analysis |
| `sonar-pro` | General search, factual queries (default) |
| `sonar` | Quick, simple lookups |

For pricing and availability: <https://docs.perplexity.ai/guides/pricing>

## Tools

### `search` — AI-powered web search

The main search tool. Automatically selects the right model based on your query. Returns a synthesized answer with cited sources.

| Parameter | Options | Description |
|---|---|---|
| `query` | string | Your search query |
| `search_context_size` | `low` / `medium` / `high` | How much web context to retrieve. `low` is fastest/cheapest (default), `high` is most thorough |
| `search_type` | `fast` / `pro` / `auto` | Search engine tier (nested in `web_search_options`) |
| `reasoning_effort` | `minimal` / `low` / `medium` / `high` | Depth of reasoning for `sonar-deep-research` |
| `strip_thinking` | boolean | Remove `<think>...</think>` blocks from reasoning model responses |
| `search_mode` | `web` / `academic` / `sec` | `academic` prioritizes peer-reviewed papers; `sec` searches SEC filings |
| `search_after_date` / `search_before_date` | `MM/DD/YYYY` | Filter sources by publication date |
| `last_updated_after` / `last_updated_before` | `MM/DD/YYYY` | Filter sources by last-updated date |
| `search_language_filter` | `["en","de"]` | Restrict sources to languages (ISO 639-1) |
| `language_preference` | ISO 639-1 | Preferred response language |
| `disable_search` | boolean | Answer from training data only (no web search) |
| `enable_search_classifier` | boolean | Let a classifier decide whether to search |
| `return_images` | boolean | Append an Images section of result URLs |
| `image_domain_filter` / `image_format_filter` | string[] | Restrict images by domain or format |
| `return_related_questions` | boolean | Append follow-up question suggestions |
| `country` / `latitude` / `longitude` | — | Localize results via `user_location` |
| `stream_mode` | `full` / `concise` | Streaming event format for Pro Search |
| `show_cost` | boolean | Append a request-cost footer when available |
| `stream` | boolean | Enable streaming responses |

Examples:
- *"What's the latest on fusion energy?"* → auto-selects `sonar-pro`
- *"Deep research analysis of CRISPR gene editing advances"* → auto-selects `sonar-deep-research`
- *"Solve this logic puzzle step by step"* → auto-selects `sonar-reasoning-pro`

### `raw_search` — Raw ranked results (no LLM)

Returns ranked web results directly without AI synthesis. Faster and cheaper — useful for URL discovery, building source lists, or fact-checking pipelines.

| Parameter | Options | Description |
|---|---|---|
| `query` | string or string[] | Search query, or an array of queries run in one request |
| `max_results` | 1–20 | Number of results (default: 10) |
| `max_tokens` / `max_tokens_per_page` | number | Token budget overall / per result |
| `search_mode` | `web` / `academic` / `sec` | Source category |
| `search_type` | `web` / `people` | `people` routes to People Search |
| `recency` | `hour` / `day` / `week` / `month` / `year` | Time window filter |
| `search_after_date` / `search_before_date` | `MM/DD/YYYY` | Filter by publication date |
| `last_updated_after` / `last_updated_before` | `MM/DD/YYYY` | Filter by last-updated date |
| `search_language_filter` | `["en","de"]` | Restrict to languages (ISO 639-1) |
| `country` | ISO 3166 code | Localize results (e.g. `US`, `GB`) |

> Note: prior versions sent these params in camelCase, which the Search API silently ignored — so `max_results`, `recency`, `search_mode` and the date filters had no effect. This is fixed; they now take effect.

### `async_research` — Long-running deep research

Submit a `sonar-deep-research` job and poll it, instead of blocking on a synchronous call. Useful when research may exceed the 5-minute synchronous timeout. Jobs expire 7 days after creation.

| Parameter | Options | Description |
|---|---|---|
| `action` | `submit` / `status` / `list` | What to do |
| `query` | string | Research question (required for `submit`) |
| `request_id` | string | Job id from a prior `submit` (required for `status`) |
| `model` | Sonar model | Job model (default: `sonar-deep-research`) |
| `reasoning_effort` | `minimal` / `low` / `medium` / `high` | Reasoning depth |
| `search_mode` | `web` / `academic` / `sec` | Source category |
| `strip_thinking` | boolean | Strip `<think>` blocks from the completed result |

```
"Submit async research: comprehensive comparison of solid-state battery startups"
→ returns a request_id
"Check async research status for <request_id>"
```

### `agent` — Agentic loop with built-in tools

The Perplexity Agent API. Runs a multi-step agent that can call built-in tools and optionally a third-party model.

| Parameter | Options | Description |
|---|---|---|
| `input` | string | The task or question |
| `model` | e.g. `openai/gpt-4.1` | Provider-qualified model |
| `models` | string[] | Fallback chain (takes precedence over `model`) |
| `preset` | `fast-search` / `pro-search` / `deep-research` | Named preset instead of a model |
| `instructions` | string | System prompt |
| `max_steps` | 1–10 | Max agentic/tool steps |
| `max_output_tokens` | number | Max output tokens |
| `tools` | `web_search` / `fetch_url` | Built-in tools the agent may use |

### `embeddings` — Text embeddings

Generate embeddings via the Perplexity Embeddings API. Returns a compact summary (model, vector count, token usage) by default.

| Parameter | Options | Description |
|---|---|---|
| `input` | string or string[] | Text(s) to embed (max 512) |
| `model` | `pplx-embed-v1-0.6b` / `pplx-embed-v1-4b` | Embedding model (default: 0.6b) |
| `dimensions` | number | Output dimensions (Matryoshka) |
| `full` | boolean | Include raw base64-encoded vectors |

### `domain_filter` — Allowlist/blocklist domains

Restrict or exclude specific domains from search results. Filters persist across all subsequent searches until cleared.

- `action: "allow"` — restrict results to this domain (allowlist mode)
- `action: "block"` — exclude this domain from results (denylist mode)
- Maximum 20 domains; cannot mix allow and block in the same filter set

```
"Allow results only from arxiv.org and nature.com"
"Block pinterest.com and reddit.com from search results"
```

### `recency_filter` — Time window filter

Limit search results to a specific time period. Persists until changed.

Options: `hour`, `day`, `week`, `month`, `year`, `none`

```
"Set recency filter to week"
"Remove the recency filter"
```

### `clear_filters` — Reset all filters

Clears all domain and recency filters in one call.

### `list_filters` — View active filters

Shows currently active domain allowlist/blocklist and recency setting.

### `model_info` — View or override model selection

View available models and current selection, or manually force a specific model.

```
"Show model info"
"Set model to sonar-deep-research"
```

## Intelligent Model Selection

The server scores your query against keyword lists to automatically pick the right model:

- Research keywords (`deep research`, `comprehensive`, `in-depth`) → `sonar-deep-research`
- Reasoning keywords (`solve`, `logic`, `mathematical`, `figure out`) → `sonar-reasoning-pro`
- Simple keywords (`quick`, `brief`, `basic`) → `sonar`
- Everything else → `sonar-pro`

Each response shows which model was used and why. If a query strongly matches a model (score ≥ 2), it will override a manually set model.

## Example Workflows

**Time-sensitive research with domain filtering:**
1. `recency_filter` → `week`
2. `domain_filter` → allow `nature.com`, allow `arxiv.org`
3. `search` → *"Recent breakthroughs in quantum error correction"*

**Financial document research:**
1. `raw_search` with `search_mode: "sec"` → find relevant filings
2. `search` with `search_mode: "sec"` → synthesized analysis

**Academic literature review:**
1. `search` with `search_mode: "academic"`, `search_context_size: "high"` → comprehensive results from peer-reviewed sources

**Deep research with reasoning control:**
1. `search` with `reasoning_effort: "high"`, `strip_thinking: true` → thorough analysis without `<think>` blocks in the output

## Development

```bash
npm run build   # Compile TypeScript to build/
npm start       # Run the built server
```

Source is in `src/` — after editing, rebuild and restart Claude to load changes.

## License

MIT
