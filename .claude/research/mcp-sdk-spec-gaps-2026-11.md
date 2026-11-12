# MCP SDK / spec best-practice gaps (perplexity-mcp)

## 2026-11-12: MCP spec + TS SDK + Claude connector guidance gap analysis

**Shape**: engineering plan (gap analysis). Scope: MCP protocol/SDK/host behaviour only; Perplexity API params and models are out of scope.

### Starting state (verified by reading the code and `node_modules`)

- `@modelcontextprotocol/sdk` **1.17.5** installed (`node_modules/@modelcontextprotocol/sdk/package.json`). Its `LATEST_PROTOCOL_VERSION` is `2025-06-18`. It has zod `^3.23.8` as a *direct* dependency, and the repo's `package.json` does not list zod.
- The low-level `Server` comes from `server/index.js`, with `setRequestHandler(ListToolsRequestSchema / CallToolRequestSchema)` and a `switch` over 15 tool names (`src/server/PerplexityMcpServer.ts:127-181`).
- `SERVER_CAPABILITIES = { tools: {} }` (`src/server/capabilities.ts`). There are no `instructions`, `resources`, or `logging`.
- `TOOL_SCHEMAS` (`src/schemas/toolSchemas.ts`) contains plain JSON Schema objects. They have **no `title`, no `annotations`, no `outputSchema`, and no `_meta`**. Zero-arg tools (`clear_filters`, `list_filters`) use `{type:"object", properties:{}}`.
- Input-validation failures are **thrown as `McpError(InvalidParams)`**, which makes them protocol errors (15 throw sites across 13 handlers). API failures are returned as `isError: true` (`src/utils/errorHandling.ts`). An unknown tool throws `ErrorCode.MethodNotFound` (-32601).
- No handler reads `extra.signal` or `_meta.progressToken`, so neither cancellation nor progress is plumbed. The Perplexity SDK request options *do* accept `signal?: AbortSignal` (`node_modules/@perplexity-ai/perplexity_ai/dist/internal/request-options.d.ts:56`).
- `agent_files` `content` returns an embedded `resource` with URI `perplexity-agent-file://{response_id}/{file_id}`. The server does not declare the `resources` capability, so that URI cannot be read through `resources/read`.
- Correction to the brief: `domain_filter` is not add/remove. It only adds allow or block entries, so it is a pure write and does not mix concerns. The mixed read/write tools are `model_info` (view, or set when `model` is passed) and `async_research` (`submit` is a billed create; `status` and `list` are reads). `agent_files` `list` and `content` are both reads, which is fine.

### Recommended plan (ordered, each step independently shippable)

1. **Add `title` and `annotations` to all 15 tools, plus server `instructions`.** This needs no SDK upgrade, because 1.17.5 already supports both (verified: `ToolAnnotations` defaults are in `dist/esm/types.js:754-784`, and `instructions?: string` is in `dist/esm/server/index.d.ts:11`). Effort S, no risk, not breaking.
   - Why it matters in Claude Code: `readOnlyHint: true` lets Claude Code **run the tool's calls in parallel** with other read-only calls. `readOnlyHint` and `idempotentHint` both mark a call as safe to repeat after a dropped connection. Unset hints fall back to the worst case (`readOnlyHint` false, `destructiveHint` true, `openWorldHint` true).
   - Proposed annotations:

     | tool | readOnly | destructive | idempotent | openWorld | note |
     |---|---|---|---|---|---|
     | search, raw_search, embeddings, contextualized_embeddings, list_models | true | – | – | true | Bills money but has no side effects |
     | agent_retrieve, agent_files | true | – | true | true | |
     | list_filters | true | – | true | **false** | Local state only |
     | async_research (until split) | false | false | false | true | `submit` creates a billed job |
     | agent | false | false? | false | true | `mcp_servers` auto-runs remote MCP tools that may have side effects. Leave `destructiveHint` at its default (true) or split out the MCP path. Ambiguous |
     | agent_cancel | false | true | true | true | Irreversibly stops a run |
     | domain_filter, recency_filter | false | false | true | false | Keeping these non-read-only also keeps them **sequential** in Claude Code, which avoids the filter races the researcher agent already documents |
     | clear_filters | false | true | true | false | |
     | model_info (until split) | false | false | true | false | |

   - `instructions` (Claude Code truncates at 4,096 characters, so put the key points first): explain the query-keyword routing to Sonar tiers, that the filter and model state persists across calls, when to prefer per-call `recency` or `search_domain_filter`, and when to use sync `search` versus `async_research` versus `agent` with `background`. With tool search on, Claude Code loads only tool names and server instructions upfront, so this text decides when Claude looks for these tools at all.
2. **Error semantics.** Return input-validation failures as `isError: true` tool results rather than thrown `McpError`, because the 2025-11-25 spec lists "Input validation errors" under Tool Execution Errors so the model can self-correct. Change the unknown-tool error from -32601 to `InvalidParams` (-32602), matching the spec example and v2 behaviour. Effort S. Not breaking for well-behaved clients, but the model now sees these messages. Claude Code keeps only the first and last 5,000 characters of error text over about 11,000 characters.
3. **SDK bump 1.17.5 → ^1.32.2 (v1.x line), and add `zod` explicitly.** Effort S. Since 1.23.0, zod is a **required peerDependency** (`^3.25 || ^4.0`). Add `"zod": "^4"`, or `^3.25`, to `dependencies` rather than relying on npm's peer auto-install. 1.32.2 was published 2026-10-23, so it clears the 7-day quarantine.
   - Behaviour to check after the bump:
     - (a) The low-level `Server` is now `@deprecated` ("Use `McpServer` instead… Only use `Server` for advanced use cases"). This is a JSDoc warning only.
     - (b) The `tools/call` wrapper now runs `safeParse(CallToolResultSchema, result)` and throws `Invalid tools/call result` on mismatch. Every handler's return shape must be spec-valid: `ErrorResponse.content[].type` is typed `string` but is always `"text"` at runtime, so it should pass. Verify with a test.
     - (c) The server now negotiates 2025-11-25.
   - v1.x targets 2025-11-25 and gets bug and security fixes "for at least six months after the v2 release (2026-07-27)", so until about **2027-01-27 at minimum**. 2026-07-28 support is not planned for v1.x.
4. **Testing harness** (do this before step 5). Effort M. Use `node:test` (built in, so no new dependency through the supply-chain gate) together with the SDK's `InMemoryTransport.createLinkedPair()` and a real `Client`. The transport already exists in 1.17.5 (`dist/esm/inMemory.d.ts`).
   - Small refactor this needs: let `PerplexityMcpServer` accept an injected `PerplexityApiService` (a fake for tests) and expose `connect(transport)` next to `run()`.
   - Tests: `listTools` snapshot (names, annotations, schemas valid against JSON Schema 2020-12, deterministic order); a `callTool` happy path per tool against the fake; validation-error paths returning `isError`; and `CallToolResultSchema` conformance, which is what step 3(b) enforces.
   - Keep `scripts/validate-params.mjs` for live Perplexity checks. The two are complementary.
   - In v2, `createLinkedPair` "connects 2025-era instances only", and `handler.fetch` is the in-process entry for 2026-07-28 coverage.
5. **Cancellation plumbing.** Effort S. Pass the request handler's `extra.signal` (v2: `ctx.mcpReq.signal`) into every Perplexity SDK call's `{ signal }` option. When a client sends `notifications/cancelled`, for example the user interrupts a 5-minute `sonar-deep-research` call, the in-flight HTTP request is aborted instead of running and billing to completion. Cancellation works the same on stdio in every protocol era (v2 guide).
6. **`_meta["anthropic/maxResultSizeChars"]` on the large-payload tools** (`async_research`, `agent_retrieve`, `agent`, `search`). Effort S. Without it, Claude Code writes any text result over 50,000 characters to a file. The `async_research` completions this repo has observed were about 80,000 characters. Values go up to a hard ceiling of 500,000. Optionally set `_meta["anthropic/requiresUserInteraction"]` on nothing: none of these tools needs a forced prompt on every call.
7. **Split mixed read/write tools.** Effort M. **BREAKING** for any caller, including `.claude/agents/*` prompts and the researcher agent's capability tables.
   - `model_info` becomes `model_info` (read-only view) plus `set_model` (write, with an `auto` option to reset).
   - `async_research` becomes `async_research_submit` (write) plus `async_research_status` and `async_research_list` (read-only, idempotent).
   - This is required for an Anthropic Directory listing ("Read and write operations must be in separate tools… documenting safe vs unsafe within one tool's description does not satisfy this"). It also helps locally: the read halves become parallel-safe and auto-approvable.
   - Ship old names as deprecated aliases for one release to soften the break.
8. **Add `outputSchema` and `structuredContent` to the data-shaped tools.** Effort M. Candidates: `raw_search` (the results array), `list_models`, `list_filters`, `agent_files` `list`, `async_research_status`, and the embeddings summaries.
   - The spec says servers **MUST** conform to a declared outputSchema and **SHOULD** also send the serialized JSON as a text block.
   - Leave prose tools (`search`, `agent`) unstructured, or give them only a loose `{answer, citations[]}` shape. Their value is the rendered markdown.
   - 2026-07-28 loosens `structuredContent` to any JSON value, but keep objects for 2025-era clients.
9. **SDK v2 migration** (`@modelcontextprotocol/server` 2.4.0). Effort M. Plan it before v1.x reaches end of life.
   - Requirements: Node ≥20, zod `^4.2.0` (v3 unsupported), and `npx @modelcontextprotocol/codemod@latest v1-to-v2 .` followed by `grep -rn '@mcp-codemod-error' .`.
   - Renames: `setRequestHandler('tools/call', …)` method strings, `McpError` → `ProtocolError`, `ErrorCode` → `ProtocolErrorCode`, `StdioServerTransport` from `@modelcontextprotocol/server/stdio`, and `extra` → `ctx` (`ctx.mcpReq.signal`, `ctx.mcpReq.notify`).
   - Use `serveStdio(() => createServer())` rather than `server.connect(new StdioServerTransport())`: the guide says the latter "serves 2025-era clients only".
   - Optional at the same time: move to `McpServer.registerTool`. v2 accepts the existing JSON Schemas through `fromJsonSchema(...)`, so no zod rewrite of `toolSchemas.ts` is needed. Not breaking on the wire.
10. **Stateful tools versus the stateless direction.** Effort M. **BREAKING** if it removes tools.
    - 2026-07-28 removes protocol sessions and says servers that need cross-call state should "use explicit, server-minted handles passed as ordinary tool arguments".
    - On stdio, one process serves one client, so `domain_filter`, `recency_filter`, `clear_filters` and `model_info` set still work. But they are hidden per-process state, and parallel calls race against them.
    - Direction: per-call params everywhere. `search` has per-call `recency` but **no per-call `search_domain_filter`**; adding one is a Perplexity-param task for the other researchers. Then deprecate the stateful tools.
    - The existing `agent` `response_id` and `async_research` `request_id` handle pattern already matches the new model.
11. **Do NOT adopt yet:**
    - MCP experimental **tasks** for `async_research` or `agent` background. 2025-11-25 tasks (SEP-1686) are not served by v2, and 2026-07-28 moved tasks to an extension with a different API.
    - MCP **logging**, **sampling** and **roots**. 2026-07-28 deprecates all three. For stdio, log to stderr instead.
    - **Elicitation**. 2026-07-28 replaces it with MRTR, and nothing in this server needs user input mid-call.
    - **Progress notifications** have low value here. The stdio idle timeout in Claude Code is 30 minutes, longer than the 5-minute API timeout. Claude Code moves calls over 2 minutes to the background anyway, and progress does not extend the per-server wall-clock `timeout`. Possible later: relay streamed tokens as progress messages when `stream: true`.
12. **Small hygiene items** (S each):
    - Zero-arg schemas should be `{type:"object", additionalProperties:false}` (the spec's recommended form).
    - Check that every description is under 4,096 characters with the key words first (Claude Code's upfront truncation limit).
    - Bump `SERVER_CONFIG.version` (0.2.0) and `package.json` (1.0.0) together; they disagree today.
    - CLAUDE.md says "All error logging is disabled for STDIO MCP compliance". That is overly strict: the spec allows UTF-8 on stderr for any logging, and only stdout must carry nothing but MCP messages. Sparse stderr logging in `onerror` would help debugging.
13. **`agent_files` and resources.** Effort M. Ambiguous value.
    - The spec says servers returning embedded resources **SHOULD** implement the `resources` capability.
    - Option A: declare `resources` with a template `perplexity-agent-file://{response_id}/{file_id}` backed by `resources/read`. Then `content` can return a `resource_link` (the client decides whether to fetch) instead of a 5 MB base64 blob, and files over the cap become fetchable on demand. The bytes still cross JSON-RPC.
    - Option B: drop the custom URI scheme and keep the embedded blob.
    - It has not been verified how Claude Code renders embedded `blob` resources that are not images.
14. **Packaging (MCPB).** Effort M. Low priority for this user.
    - The skill itself says a server that only calls a cloud API is "a remote server wearing an MCPB costume". MCPB's main benefit here is `user_config.PERPLEXITY_API_KEY` with `sensitive: true` (stored in the OS keychain) and a one-file install into Claude Desktop, which runs on macOS and Windows only.
    - Manifest `manifest_version: "0.4"`; CLI `@anthropic-ai/mcpb` (`init`/`validate`/`pack`/`sign`). The repo has moved to `modelcontextprotocol/mcpb`.
    - For Claude Code on Linux, a Claude Code plugin with an `.mcp.json` entry is the closer fit.
    - **Directory listing is not available**: the review criteria require that "Your server must call your own first-party APIs, or APIs you legitimately proxy", and a third-party Perplexity wrapper fails that. Treat the review criteria as best-practice guidance, not a submission target.

### Documentation Sources

- MCP spec 2026-07-28 changelog (latest revision): https://modelcontextprotocol.io/specification/2026-07-28/changelog.md
- MCP spec 2025-11-25 changelog: https://modelcontextprotocol.io/specification/2025-11-25/changelog
- MCP spec 2025-11-25 Tools (annotations, tool names, structuredContent/outputSchema, resource_link, error handling): https://modelcontextprotocol.io/specification/2025-11-25/server/tools.md
- MCP spec 2025-11-25 Transports (stdio stderr rules): https://modelcontextprotocol.io/specification/2025-11-25/basic/transports.md
- TS SDK releases (1.32.2 on 2026-10-23, 2.4.0 latest): https://github.com/modelcontextprotocol/typescript-sdk/releases
- TS SDK 1.32.0 upgrade notes: https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/1.32.0
- TS SDK 1.23.0 (zod v4 support, zod becomes a peer, 2025-11-25): https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/1.23.0 and https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/1.23.0-beta.0
- TS SDK ROADMAP (v2.0.0 released 2026-07-27; v1.x maintenance ≥6 months; v2 does not serve SEP-1686 tasks): https://github.com/modelcontextprotocol/typescript-sdk/blob/main/ROADMAP.md
- v1.x README ("maintenance line", up to 2025-11-25, 2026-07-28 not planned): https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/v1.x/README.md
- v1.x `Server` source (`@deprecated`, CallToolResultSchema validation): https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/v1.x/src/server/index.ts
- v2 upgrade guide: https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2.md
- v2 packages (server-legacy and codemod are migration-only): https://ts.sdk.modelcontextprotocol.io/v2/get-started/packages
- v2 testing (InMemoryTransport, handler.fetch): https://ts.sdk.modelcontextprotocol.io/v2/testing.html
- npm registry: https://registry.npmjs.org/@modelcontextprotocol/sdk/latest (1.32.2, zod peer `^3.25 || ^4.0`, node ≥18) and https://registry.npmjs.org/@modelcontextprotocol/server (2.4.0, zod `^4.2.0`, node ≥20, 2.0.0 published 2026-07-27)
- Claude connector review criteria: https://claude.com/docs/connectors/building/review-criteria
- Claude Code MCP client behaviour (output limits, `anthropic/maxResultSizeChars`, `anthropic/requiresUserInteraction`, readOnlyHint parallelism, idle timeout, auto-background, description truncation): https://code.claude.com/docs/en/mcp-configuration
- Agent SDK annotation defaults and parallelism: https://code.claude.com/docs/en/agent-sdk/custom-tools and https://code.claude.com/docs/en/agent-sdk/agent-loop.md
- MCPB CLI: https://github.com/modelcontextprotocol/mcpb/blob/main/CLI.md; manifest v0.4 reference: https://github.com/anthropics/claude-plugins-official/blob/main/plugins/mcp-server-dev/skills/build-mcpb/references/manifest-schema.md
- Local skill guidance: `~/.claude/plugins/cache/anthropic-plugin-directory/mcp-server-dev/a2e251d9b97b-c616a5e9/skills/build-mcp-server/references/{tool-design,server-capabilities,elicitation,resources-and-prompts}.md`, `../build-mcpb/SKILL.md`

### Conflicts resolved

- **The brief said "latest is 1.32.2".** That is true only for the `@modelcontextprotocol/sdk` package. The current stable SDK is v2 (2.4.0), shipped as split packages. Resolved with the releases page, the npm registry and ROADMAP, which agree on the 2026-07-27 release date.
- **The skill's `tool-design.md` says the Directory requires `readOnlyHint`, `destructiveHint` and `title` on every tool.** The live review-criteria page says "a `title` and the applicable hint". The live page wins (more recent, and it is the source). In practice, set all four hints anyway.
- **Annotation defaults.** These were read from installed SDK source (`types.js`), not recalled: readOnly false, destructive true, idempotent false, openWorld true. They match the Agent SDK docs table.
- **v1.32 `Server` deprecation versus v2 guide.** v1.32 JSDoc deprecates `Server`. The v2 guide says the low-level `Server` constructor is "unchanged" and still usable. Conclusion: `Server` is a supported advanced API in both. The deprecation steers new code to `McpServer` and does not signal removal.

### Unverified / single-sourced

- Whether Claude Code honours `destructiveHint` for interactive confirmation of MCP tools. Docs confirm only that readOnly means parallel and idempotent or readOnly means retry-safe; the review page says hints "determine auto-permissions in Claude".
- How Claude Code renders non-image embedded `blob` resources (`agent_files`).
- Whether the 1.17.5 → 1.32.2 bump surfaces a `CallToolResultSchema` validation failure in any handler. This needs the step-4 tests or a manual Inspector run.
