# Perplexity MCP Server

An MCP server that provides Perplexity AI web search capabilities to Claude, with automatic model selection, stateful filters, and 7 purpose-built tools.

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
| `reasoning_effort` | `minimal` / `low` / `medium` / `high` | Depth of reasoning for `sonar-deep-research` |
| `strip_thinking` | boolean | Remove `<think>...</think>` blocks from reasoning model responses |
| `search_mode` | `web` / `academic` / `sec` | `academic` prioritizes peer-reviewed papers; `sec` searches SEC filings |
| `stream` | boolean | Enable streaming responses |

Examples:
- *"What's the latest on fusion energy?"* → auto-selects `sonar-pro`
- *"Deep research analysis of CRISPR gene editing advances"* → auto-selects `sonar-deep-research`
- *"Solve this logic puzzle step by step"* → auto-selects `sonar-reasoning-pro`

### `raw_search` — Raw ranked results (no LLM)

Returns ranked web results directly without AI synthesis. Faster and cheaper — useful for URL discovery, building source lists, or fact-checking pipelines.

| Parameter | Options | Description |
|---|---|---|
| `query` | string | Search query |
| `max_results` | 1–20 | Number of results (default: 10) |
| `search_mode` | `web` / `academic` / `sec` | Search type |
| `recency` | `hour` / `day` / `week` / `month` / `year` | Time window filter |
| `search_after_date` | `MM/DD/YYYY` | Only results after this date |
| `search_before_date` | `MM/DD/YYYY` | Only results before this date |
| `country` | ISO 3166 code | Localize results (e.g. `US`, `GB`) |

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
