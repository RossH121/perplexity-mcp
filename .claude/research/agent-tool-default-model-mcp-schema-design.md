# Agent Tool: Default Model/Preset Handling and MCP Schema Design

## 2026-05-31 — Engineering plan: server-side default + validation approach for agent tool one-of requirement

**Shape**: engineering plan

---

## Recommended Plan

### Summary recommendation

Apply all three strategies in combination, in this order of priority:

1. **Server-side default: inject `preset: "pro-search"` when all three of `model`, `models`, `preset` are absent.** This is the primary fix — it eliminates the wasted round-trip 400 and gives the LLM a working call with zero additional arguments. `pro-search` is the right default (see reasoning below).
2. **Local pre-flight validation: check before calling the API** and return a clear `InvalidParams` MCP error with the constraint spelled out in plain text. This fires only if the default injection logic is somehow bypassed (e.g. a future code path), and serves as a safety net.
3. **Description-layer constraint: encode the "one-of" rule in the tool description text**, not in JSON Schema combinators. Do not use `oneOf`/`anyOf` at the schema level — they are unreliable across MCP clients.

### Step 1 — Inject default in `agentRespond()` (primary fix, 3-line change)

In `src/services/PerplexityApiService.ts`, inside `agentRespond()`, before `body["stream"] = false`:

```typescript
// Ensure at least one of model/models/preset is present.
// Default to "pro-search" — Perplexity's balanced preset — when none supplied.
if (!args.model && !args.models?.length && !args.preset) {
  body["preset"] = "pro-search";
}
```

This is the right place: it runs immediately before the API call, it is unconditional, and it is invisible to the MCP caller (the tool still returns a good result). The default applies only as a last resort — if the LLM explicitly supplies any of the three, the condition is false and the explicit value wins.

### Step 2 — Add pre-flight validation in `isValidAgentArgs()` (safety net, optional)

In `src/schemas/validation.ts`, inside `isValidAgentArgs()`, after the `input` check:

```typescript
// "at least one of model/models/preset" — mirrors the API's own requirement.
// In practice the server injects "pro-search" as a default, but we validate
// here so hand-written callers get a clear error instead of a cryptic 400.
// NOTE: Commented out by default because the default-injection in
// agentRespond() makes this redundant for LLM callers. Uncomment if you
// want strict mode that forces explicit selection.
//
// const hasModelSelection = a.model !== undefined ||
//   (Array.isArray(a.models) && a.models.length > 0) ||
//   a.preset !== undefined;
// if (!hasModelSelection) return false;
```

Decision: leave this commented out, because the server-side default makes the tool call succeed anyway. Enforcing the constraint in validation would cause all existing no-model calls to fail at the MCP layer before they reach the default-injection — opposite of the desired ergonomic behavior. If you ever want "force explicit selection" mode, uncomment.

### Step 3 — Update tool description (schema-layer ergonomics)

In `src/schemas/toolSchemas.ts`, update the `agent` tool's `description` and the `preset`/`model` property descriptions:

**Tool-level description** — add at the end:
```
"... At least one of model, models, or preset is required by the API; if none is supplied the server defaults to preset 'pro-search'."
```

**`preset` property description** — make the default explicit:
```
"Named preset instead of a specific model: 'fast-search' (speed, low cost), 'pro-search' (balanced — default when no model is specified), or 'deep-research' (multi-step, high quality, slow)."
```

**`model` property description** — clarify relationship to preset:
```
"Provider-qualified model, e.g. 'anthropic/claude-sonnet-4-6'. If omitted with no preset or models, defaults to preset 'pro-search'. Can be combined with preset to override the preset's default model."
```

### Step 4 — Fix stale SDK JSDoc (cosmetic but prevents confusion)

The SDK's own type comment in `ResponsesCreateParams` (`responses.d.ts` line 576) says:
```
Preset configuration name (e.g., "sonar-pro", "sonar-reasoning").
```
These names are wrong — "sonar-pro" and "sonar-reasoning" are Sonar Chat Completions model names, not Agent API presets. The current canonical preset names are `fast-search`, `pro-search`, `deep-research`. The SDK type definition uses `preset?: string` (untyped string), so there is no compile-time guard. Do not rely on the JSDoc; rely on the API reference and the `VALID_AGENT_PRESETS` constant in `types.ts` which already has the correct values.

No code change needed here — `VALID_AGENT_PRESETS` is already correct. This is a documentation-only conflict.

---

## Documentation Sources

### Perplexity Agent API

- **API reference — Create Agent Response**: https://docs.perplexity.ai/api-reference/agent-post
  - Official field-level descriptions for `model`, `models`, `preset`. Confirms the exact 400 message and the "at least one of" rule.
- **Agent API — Models**: https://docs.perplexity.ai/docs/agent-api/models
  - Lists all available models by provider (Perplexity, Anthropic, OpenAI, Google, xAI, NVIDIA). Confirms `model` and `models` fields. States "Looking for pre-configured model setups? See Presets."
- **Agent API — Presets** (page scraped, content in large single-line JSON): https://docs.perplexity.ai/docs/agent-api/presets
  - Three canonical presets: `fast-search`, `pro-search`, `deep-research`. Confirmed from grep of scraped content.
- **Agent Research Assistant example**: https://docs.perplexity.ai/docs/cookbook/examples/agent-research-assistant/README
  - Shows `preset="deep-research"` + model override pattern; confirms model and preset are composable.
- **SDK types**: `node_modules/@perplexity-ai/perplexity_ai/resources/responses.d.ts`
  - `ResponsesCreateParams` and `ResponseCreateParamsBase`: all three of `model?`, `models?`, `preset?` are optional. JSDoc comments confirm the one-of requirement in English but use wrong example preset names.

### MCP Specification and Client Behavior

- **MCP Tools concept**: https://modelcontextprotocol.io/docs/concepts/tools
  - `inputSchema` is "JSON Schema defining expected parameters." Spec shows only flat `type/properties/required` in examples — no `oneOf`/`anyOf` examples are given.
- **MCP issue #2806**: https://github.com/modelcontextprotocol/modelcontextprotocol/issues/2806
  - Filed 2026-05-27 by an SDK author. Confirms `oneOf` in `inputSchema` "isn't practically consumable by tool-calling LLMs." A Perplexity MCP maintainer (`olaservo`) self-assigned it acknowledging the spec-vs-implementation gap. Status: open.
- **OpenAPI-to-MCP conversion lessons (Stainless, 2026-05-07)**: https://www.stainless.com/blog/lessons-from-openapi-to-mcp-server-conversion/
  - Client capabilities matrix: OpenAI supports `anyOf` but not at root. Claude Desktop supports top-level `anyOf` "mostly." Claude Code does NOT handle top-level `anyOf`. Cursor: no `anyOf` support at all. These clients handle the constraint by collapsing to first variant or dropping it.
- **Discourse AI MCP integration**: https://meta.discourse.org/t/ai-bot-bring-your-own-mcp-server/399667
  - Explicitly collapses `anyOf`/`oneOf` to first non-null variant.
- **MCP tool design best practices**: https://www.philschmid.de/mcp-best-practices and https://www.arcade.dev/blog/mcp-tool-patterns/
  - Guidance: minimize required params, provide safe defaults, keep schemas flat, put behavioral constraints in natural-language descriptions rather than JSON Schema combinators.
- **AWS Prescriptive Guidance on MCP tool design**: https://docs.aws.amazon.com/prescriptive-guidance/latest/mcp-strategies/mcp-tool-strategy.html

---

## Supporting Research / Key Findings

### Half 1: Perplexity Agent API specifics

**Q1: Is there a recommended or default model/preset?**

The API reference does not name a recommended default. The API simply errors with 400 if all three are absent. However:
- The model docs page explicitly links from "Available Models" to "Presets" with the text "Looking for pre-configured model setups? See Presets — optimized for specific use cases." This signals that presets are the intended entry point for users who don't want to pick a raw model.
- `pro-search` is the balanced middle option — faster and cheaper than `deep-research`, more capable than `fast-search`. It is the correct default for a general-purpose MCP tool serving unknown query types.

**Q2: Semantic difference between model, models, preset**

From the API reference field descriptions (verbatim):
- `model`: "Model ID in provider/model format (e.g., 'openai/gpt-5', 'anthropic/claude-sonnet-4-6'). If models is also provided, models takes precedence. Required if neither models nor preset is provided."
- `models`: "Model fallback chain. Each model is in provider/model format. Models are tried in order until one succeeds. Max 5 models allowed. If set, takes precedence over single model field. The response.model will reflect the model that actually succeeded."
- `preset`: "Preset configuration name (e.g., 'fast-search', 'pro-search', 'deep-research'). Pre-configured model with system prompt and search parameters. Required if model is not provided."

Semantic summary:
- `preset` = bundled model + system prompt + search configuration + tool policy. The caller doesn't need to know which model runs under it.
- `model` = explicit model selection (no preset tooling; you must also supply `tools` if you want tool calls).
- `models` = fallback chain of explicit models for high-availability.

**Q3: Are presets the intended "default path"?**

Yes. The models documentation explicitly redirects to presets for users who want pre-configured setups. The research assistant cookbook uses `preset="deep-research"` as its baseline and overrides model separately. Presets are the ergonomic entry point.

**Q4: Does specifying preset together with tools or reasoning_effort conflict?**

From research: The cookbook example shows `response_format` composing cleanly with `preset`. The API reference shows `tools` and `reasoning` as separate top-level fields from `preset`. The `max_steps` field explicitly says "If provided, overrides the preset's max_steps value." This confirms preset + override fields compose rather than conflict.

From the SDK type definition:
- `ResponsesCreateParams` includes `preset?`, `tools?`, `reasoning?`, `max_steps?` all as independent optional fields.
- The API docs for `max_steps` state explicitly: "If provided, overrides the preset's max_steps value."

Conclusion: preset defines defaults; per-request fields override those defaults. There is no documented conflict between `preset` and `tools`/`reasoning_effort`. However, Perplexity docs do not explicitly specify what happens when you supply `tools` alongside a `preset` that already configures tools internally — this is a documentation gap, not a confirmed conflict. Safe assumption: explicit `tools` in the request body takes precedence or merges with preset tools. In practice the tool already maps `args.tools` into `body["tools"]` independently of `preset`, which is the correct approach.

**Q5: Cost/latency guidance across presets**

From Perplexity Perplexity search results (no specific pricing table found for presets):
- `fast-search`: "Optimized for speed + low cost on simple or short-answer queries. Minimal reasoning steps, quick web search."
- `pro-search`: "Balanced speed and depth. A few reasoning steps (e.g. up to ~3). More deliberate than fast-search."
- `deep-research`: "Complex, in-depth analysis and multi-step research. Up to 10K tokens context and up to 10 reasoning steps. Many searches, reads, aggregates, synthesizes a structured report." High latency, highest cost.

For a general-purpose MCP tool, `pro-search` is the correct default: fast enough for interactive use, capable enough for non-trivial queries.

### Half 2: MCP tool schema design

**Q6: Recommended pattern for "at least one of" optional group**

The evidence is unambiguous: server-side default is the correct primary mechanism. The options ranked:

(a) **Server-side default** — recommended. Makes any call with only `input` work. Zero LLM friction.
(b) **Local validation** — useful as a safety net but should not be the primary mechanism when a sensible default exists.
(c) **JSON Schema anyOf/oneOf** — not reliable. See evidence below.
(d) **Combination of (a) + description-layer constraint** — the right answer.

**Q7: Does MCP inputSchema anyOf/oneOf actually work?**

No, not reliably. Evidence from multiple independent sources:

1. **MCP issue #2806 (filed 2026-05-27, open)**: "the LLM tool-calling layer downstream of MCP clients (Claude, GPT-4 family) does not reliably consume `oneOf` — models silently ignore the constraint or refuse the tool call." MCP maintainer `olaservo` confirmed the gap.

2. **Stainless OpenAPI-to-MCP conversion (2026-05-07)**: Claude Code specifically does NOT handle top-level `anyOf`. OpenAI only supports `anyOf`, not `oneOf`. Cursor supports neither.

3. **Discourse AI**: explicitly collapses `anyOf`/`oneOf` to first non-null variant, discarding alternatives.

4. **MCP spec**: All worked examples use flat `type/properties/required` — no `oneOf`/`anyOf` in any official example. The spec text says "restricted subset of JSON Schema."

The current code already uses `oneOf` in the `embeddings` tool's `input` field (line 386-390 of toolSchemas.ts). That is a type-union for string vs string[], which is a common pattern and different from a cross-field one-of constraint. It may or may not work on all clients but is less critical than the agent model-selection constraint.

**Q8: Minimize required params vs force explicit choice?**

All MCP best-practice sources agree: minimize required params, provide good defaults. From philschmid.de and arcade.dev: "Required: only what is strictly necessary to execute safely and meaningfully. Optional (with defaults): everything that has a safe, intention-preserving default." The MCP spec's own examples use `required: ["location"]` for a single truly-required field.

For the `agent` tool: `input` is the only truly required field. The model-selection group should have a server-side default and be treated as optional from the schema's perspective, with the default documented in text.

---

## Best Practices & Potential Issues

### SDK JSDoc vs API Reference conflict (important)

`responses.d.ts` JSDoc for `preset` says: `e.g., "sonar-pro", "sonar-reasoning"` — these are wrong. Canonical preset names are `fast-search`, `pro-search`, `deep-research`. The `VALID_AGENT_PRESETS` constant in `types.ts` already has the correct values. The SDK is typed as `preset?: string` (no enum), so there is no compile-time guard; wrong values will pass TypeScript but fail at the API. The JSDoc mismatch is a documentation bug in the SDK package, not something this codebase can fix upstream.

### tools + preset composition: undocumented behavior

The Perplexity docs do not explicitly document what happens when `tools` is supplied alongside `preset`. Based on field-level descriptions and the `max_steps` override semantics, the safe inference is that explicit request fields override preset defaults. The current `agentRespond()` implementation passes them as independent body keys, which is correct.

### reasoning_effort + preset composition

`reasoning` (nested `{ effort }`) is an independent top-level field from `preset` in the API schema, and the SDK types show them as separate fields. No documented conflict. Passes through fine.

### The default should NOT be applied in the MCP schema's required list

Do not add `preset` to the `required` array in the tool's inputSchema. The schema-level `required: ["input"]` is correct. The default-injection happens server-side (in `agentRespond`), not via schema enforcement.

### Background + preset

`background: true` requires the response to be polled. No interaction with the preset choice — safe to combine.

---

## Project-Specific Adaptations

**Current state of the code:**

- `isValidAgentArgs()` accepts args with no model/models/preset (returns `true` as long as `input` is a non-empty string). This is correct behavior — the validation function should not reject a call that the server will handle via default injection.
- `agentRespond()` in `PerplexityApiService.ts` passes model/models/preset only when present (`if (args.model !== undefined)`). Adding the default injection (Step 1) here is the minimal, correct fix.
- The tool description currently says: "Distinct from 'search' (single grounded answer). For long-running work, set background:true and poll the returned id with agent_retrieve." — add the default statement here.

**Files to change:**

1. `src/services/PerplexityApiService.ts` — add 3-line default injection in `agentRespond()`
2. `src/schemas/toolSchemas.ts` — update `agent` description and `preset`/`model` descriptions
3. `src/schemas/types.ts` — no changes needed; `VALID_AGENT_PRESETS` already correct

**Do not change:** `src/schemas/validation.ts` — `isValidAgentArgs()` is correctly permissive.

**Risk:** The default `pro-search` preset will incur real cost on every agent call where no model is specified. This is acceptable — the alternative is a 400 error, which costs nothing but also returns nothing useful. Document the default in CLAUDE.md so future maintainers know it exists.
