# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Commands

### Build and Development
- `npm run build` - Build the TypeScript project (compiles to `build/` directory and sets executable permissions)
- `npm start` - Run the built server from `build/index.js`
- `npm install` - Install dependencies

### Testing and Linting
This project does not currently have automated tests or linting configured.

## Architecture Overview

This is a Model Context Protocol (MCP) server that provides Perplexity AI web search capabilities to Claude. The server acts as a bridge between Claude and Perplexity's search API with intelligent model selection and filtering capabilities.

### Core Architecture Pattern

The codebase follows a modular, handler-based architecture:

- **Server Layer** (`src/server/`): Main MCP server implementation and capabilities
- **Services Layer** (`src/services/`): Business logic for API communication and model selection
- **Handlers Layer** (`src/handlers/`): Request handlers for different tool operations
- **Models Layer** (`src/models/`): State management classes
- **Configuration** (`src/config/`): Environment and constant configuration

### Key Components

**PerplexityMcpServer** (`src/server/PerplexityMcpServer.ts`):
- Main server class that orchestrates all handlers and services
- Manages state including current model and filter settings
- Recreates SearchHandler on each request to ensure fresh state

**ModelSelectionService** (`src/services/ModelSelectionService.ts`):
- Implements intelligent model selection based on query keywords
- Maps queries to appropriate Perplexity models (sonar, sonar-pro, sonar-reasoning, etc.)
- Falls back to default model when no keywords match

**FilterState** (`src/models/FilterState.ts`):
- Manages domain and recency filtering state
- Enforces API limits (max 20 domains)

**Handler Pattern**:
Each tool operation has a dedicated handler class:
- `SearchHandler` - Main search functionality with model selection
- `RawSearchHandler` - Raw ranked results via `/search` endpoint (no LLM)
- `AsyncResearchHandler` - Submit/poll/list async deep-research jobs (`client.async.chat.completions.*`)
- `AgentHandler` - Agent API via `client.responses.create` (third-party models, built-in tools, structured output, background runs); exports the shared `renderAgentResponse` formatter
- `AgentRetrieveHandler` - Poll a background agent run via `client.responses.retrieve`
- `EmbeddingsHandler` - Embeddings API via `client.embeddings.create`
- `DomainFilterHandler` - Domain allow/block management
- `RecencyFilterHandler` - Time window filtering
- `FilterManagementHandler` - Clear and list filters
- `ModelInfoHandler` - Model information and manual selection
- `ModelListHandler` - Dynamic model discovery via `GET /v1/models` (no typed SDK resource; uses the generic `client.get()`); groups the live catalog by provider

Shared rendering helpers (Sources/Images/Related Questions/cost footer, `stripThinkingBlocks`) live in `src/utils/responseFormatting.ts` and are reused by `SearchHandler` and `AsyncResearchHandler`.

### Environment Configuration

The server requires:
- `PERPLEXITY_API_KEY` - API key for Perplexity service
- `PERPLEXITY_MODEL` (optional) - Default model (defaults to "sonar-pro")

### Model Selection Logic

The system automatically selects Perplexity models based on query content:
- Research keywords → `sonar-deep-research`
- Reasoning keywords → `sonar-reasoning-pro` (sonar-reasoning was removed Dec 2025)
- Simple keywords → `sonar`
- General queries → `sonar-pro` (default)

### MCP Tool Schema

The server exposes 12 MCP tools:
- `search` - Main search with automatic model selection. Supports `search_context_size`, `search_type` (`fast`/`pro`/`auto`), `reasoning_effort`, `strip_thinking`, `search_mode`, published/last-updated date filters (`search_after_date`, `search_before_date`, `last_updated_after`, `last_updated_before`), `search_language_filter`, `language_preference`, `disable_search`, `enable_search_classifier`, `stream` (boolean toggle) / `stream_mode`, image controls (`return_images`, `image_domain_filter`, `image_format_filter`), `return_related_questions`, `country`/`latitude`/`longitude`/`city`/`region` (user_location), per-call `recency` (overrides the stateful filter without mutating it), sampling controls (`stop`, `temperature`, `top_p`, `max_tokens`), `response_format` (JSON-schema structured output), and `show_cost`
- `raw_search` - Raw ranked results via `/search` endpoint (no LLM synthesis). Accepts a single query or an array of queries; supports `max_results`, `max_tokens`, `max_tokens_per_page`, `search_mode`, `search_type` (`web`/`people`), `recency`, date filters, `last_updated_*`, `search_language_filter`, `search_domain_filter` (max 20; `-` prefix excludes), country
- `async_research` - Submit/poll/list async deep-research jobs (`action`: `submit`/`status`/`list`). Jobs have a 7-day TTL
- `agent` - Agent API: agentic loop with built-in tools (`web_search`, `fetch_url`, `people_search`, `finance_search`, `sandbox`), presets (`fast-search`/`pro-search`/`deep-research`/`advanced-deep-research`), and provider-qualified third-party models (e.g. `openai/gpt-4.1`). Also supports `reasoning_effort` (nested `reasoning.effort`; `minimal`/`low`/`medium`/`high`/`xhigh`), `response_format` (JSON-schema structured output), and `background` (queue the run, then poll with `agent_retrieve`)
- `agent_retrieve` - Retrieve the result/status of a background `agent` run by `response_id` (`client.responses.retrieve`)
- `embeddings` - Generate embeddings (`pplx-embed-v1-0.6b` / `pplx-embed-v1-4b`); optional `dimensions` (Matryoshka truncation: 128–1024 for 0.6b, 128–2560 for 4b); compact summary by default, raw base64 vectors with `full: true`
- `domain_filter` - Add/remove domain filters (persists across calls)
- `recency_filter` - Set time window filters (`hour`, `day`, `week`, `month`, `year`, `none`)
- `clear_filters` - Clear all filters
- `list_filters` - List current filter settings
- `model_info` - View/set model information (stateful Sonar selection for `search`)
- `list_models` - Dynamic model discovery via the live `GET /v1/models` endpoint; lists models available to the account (Sonar + provider-qualified third-party models for the `agent` tool), grouped by provider, with an optional `provider` filter. Distinct from `model_info`. Called through the generic `client.get("/v1/models")` since the SDK has no typed `models` resource

## Development Notes

- TypeScript project with ES2022 target and Node16 modules
- Uses MCP SDK for protocol compliance
- Uses `@perplexity-ai/perplexity_ai` official SDK `^0.31.0` (replaces axios)
- All error logging is disabled for STDIO MCP compliance
- The SearchHandler is recreated on each request to ensure current model state is used
- Domain filtering has a maximum of 20 domains (API limitation); cannot mix allow/block in same filter set
- `search_context_size`, `search_type`, and `user_location` are nested under `web_search_options` in the API request (not top-level)
- The SDK calls are invoked through `as Function`/`as any` casts, so TypeScript does NOT catch request-param typos — when adding params, verify names against `node_modules/@perplexity-ai/perplexity_ai/resources/*.d.ts`, not just a clean build
- The Search API (`client.search.create`) expects **snake_case** body keys (`max_results`, `search_mode`, …); camelCase keys are silently ignored by the API. (A prior bug sent camelCase, so `raw_search` dropped most params — fixed.)
- `reasoning_effort` (`minimal`/`low`/`medium`/`high`) is only meaningful for `sonar-deep-research`
- API timeout is 5 minutes (needed for sonar-deep-research which can take 30+ seconds); for longer research use the `async_research` tool
- Valid Sonar models: `sonar`, `sonar-pro`, `sonar-reasoning-pro`, `sonar-deep-research` (`sonar-reasoning` was removed Dec 15, 2025). Agent API additionally accepts provider-qualified third-party models
- The Agent API's canonical endpoint is `/v1/agent` as of the March 2026 changelog; `/v1/responses` (what `client.responses.create`/`.retrieve` resolve to) remains a working OpenAI-compatible alias, so no SDK-level change is required
- `image_results_enhanced_relevance` is a 4th field nested under `web_search_options` (alongside `search_context_size`, `search_type`, `user_location`)