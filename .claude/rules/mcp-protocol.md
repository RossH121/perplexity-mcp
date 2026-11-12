---
paths:
  - "src/server/**"
  - "src/index.ts"
  - "src/schemas/toolSchemas.ts"
  - "src/schemas/outputSchemas.ts"
  - "src/utils/structuredResult.ts"
  - "src/utils/errorHandling.ts"
  - "src/utils/agentFileUri.ts"
  - "src/models/AgentFileRegistry.ts"
---

# MCP protocol layer

## SDK v2
- We use the low-level `Server` from `@modelcontextprotocol/server` (v2) with hand-written JSON Schemas, not `McpServer`/`registerTool`. Handlers are registered by method string (`setRequestHandler("tools/call", (request, ctx) => ...)`) and the cancel signal is at `ctx.mcpReq.signal`. Errors are `ProtocolError`/`ProtocolErrorCode`
- `run()` must go through `serveStdio()` from `@modelcontextprotocol/server/stdio`. It serves both protocol eras: 2025 (`initialize`, up to 2025-11-25, what Claude Code speaks today) and 2026-07-28 (`server/discover`, stateless requests). Connecting a `StdioServerTransport` directly would serve the 2025 era only
- In the 2026-07-28 era, `instructions` and capabilities arrive on `server/discover`, server identity goes in each result's `_meta["io.modelcontextprotocol/serverInfo"]`, and `list_changed` notifications only reach a client-opened `subscriptions/listen` stream. `serveStdio` handles that routing
- Deliberately not adopted (decision 2026-11-12): MCP tasks, logging, sampling, roots, elicitation, progress. Tasks moved to an extension and v2 drops the 2025 version; logging, sampling and roots are deprecated in 2026-07-28; elicitation is replaced by multi-round-trip requests; progress adds little given Claude Code's 30-min stdio idle timeout. Reasoning in `.claude/research/mcp-sdk-spec-gaps-2026-11.md`

## outputSchema
- Schemas live in `src/schemas/outputSchemas.ts`. Rules: a root `type:"object"`, no root `oneOf`/`anyOf` (some clients choke), open objects, and fields that are always present but may be empty typed `["x","null"]`. Coerce API values with `strOrNull`/`numOrNull`/`intOrNull`/`toSources`
- The SDK `Server` never checks results against outputSchema, but the `Client` does (Ajv, after `listTools()`) and throws on a mismatch. `src/server/outputValidation.ts` therefore re-validates server-side and turns a mismatch into an `isError` result that keeps the text. Error results never carry `structuredContent`
- v2's Ajv defaults to JSON Schema 2020-12 for schemas without `$schema` (v1 used draft-07). Import the validator from `@modelcontextprotocol/server/validators/ajv`; there's no separate `ajv` dependency
- Deprecated aliases, write tools and `agent_cancel` stay untyped

## Resources
- `agent_files` content is exposed as resources: template `perplexity-agent-file://{response_id}/{file_id}`, ids percent-encoded (`src/utils/agentFileUri.ts`). `resources/list` only shows files this process has seen (`AgentFileRegistry`, capped at 200), because the API can't list them
- An unknown resource returns `ResourceNotFoundError`, which v2 sends as -32602 in every era (v1 sent -32002); an oversized one returns -32600
- `agent_files list` returns `resource_link` blocks, but `content` keeps the embedded resource. In Claude Code an embedded resource is handled in one step (PDFs become documents, images render, other files are saved to disk), while a `resource_link` needs a second read

## Tool metadata
- `_meta["anthropic/maxResultSizeChars"]: 500000` is set on `search`, `async_research_status`, the `async_research` alias, `agent` and `agent_retrieve`. Without it Claude Code writes results over 50,000 chars to a file
- Zero-argument tools use `additionalProperties: false`
