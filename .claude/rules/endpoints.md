---
paths:
  - "src/handlers/DecisionsHandler.ts"
  - "src/handlers/SkillsHandler.ts"
  - "src/handlers/EmbeddingsHandler.ts"
  - "src/handlers/ContextualizedEmbeddingsHandler.ts"
  - "src/schemas/validation.ts"
---

# Decisions, Skills and embeddings

## Decisions (`decisions`, verified 2026-11-12)
- The yes/no question type is `noul`, not `binary`
- Every malformed body gets the same generic 400 with `param: null`, so `decisionsArgsError()` checks question shapes client-side to name the bad field
- The SDK's request type omits `mode` and `max_staleness`, but `client.decisions.create` forwards them. `max_staleness` without `mode` is accepted and ignored
- The response has no cost field and no rationale. Cost is estimated (`estimateDecisionCost()`) from token usage plus an undocumented `usage.tool_calls_details` count of searches and fetches under `web_grounding`

## Skills (`list_skills`)
- An unknown `skill_id` returns 400, not 404. The test account has no custom skills, so only the empty-list path has been verified live

## Embeddings
- `contextualizedEmbeddings` is its own client resource (`client.contextualizedEmbeddings.create`), with its own model family (`pplx-embed-context-v1-*`). Its models aren't interchangeable with the plain `pplx-embed-v1-*` ones
- Omitting `encoding_format` returns `base64_int8`; there's no float output (2026-11-12). Costs are tiny (~$1e-8), so format them with `src/utils/formatUsd.ts` rather than printing exponent notation
