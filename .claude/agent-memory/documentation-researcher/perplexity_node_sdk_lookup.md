---
name: perplexity-node-sdk-lookup
description: Where to find current generated TS types for @perplexity-ai/perplexity_ai after the 0.38.0 restructure, and how to extract from them reliably
metadata:
  type: reference
---

As of `@perplexity-ai/perplexity_ai` 0.38.0 (2026-07-30), the SDK's internal file layout changed (Stainless-style generated-client refactor). Old lookup paths like `unpkg.com/@perplexity-ai/perplexity_ai@latest/resources/responses.d.ts` now 404, that path only re-exports. The real generated types live at:

`https://unpkg.com/@perplexity-ai/perplexity_ai@latest/dist/generated/api.d.ts`

This single file holds types for every resource (chat/Sonar, search, responses/Agent, embeddings, async, etc.), it's large, so `WebFetch`'s summarizing model misses fields on a broad "extract everything" ask. Ask narrow, repeated questions ("search specifically for substring X, quote every line containing it") rather than one broad extraction pass; a broad ask on this file silently dropped `service_tier`/`prompt_cache_key` that a narrower follow-up then found were genuinely absent from the *generated types* (though present in changelog/guide prose, a real doc gap, not an extraction miss, confirmed by then also checking the official `/api-reference/agent-post` page, which likewise omits them).

If `node_modules` is present in the repo being researched, check its actual installed version first (`cat node_modules/<pkg>/package.json`), semver ranges don't always get re-resolved; found this exact repo pinned at `^0.31.0` with `node_modules` never having moved past `0.31.0` despite 7 newer releases existing.

Also useful: [[perplexity-api-delta-lookup]] for the broader pattern of cross-checking changelog prose against the formal API reference page, they can disagree, and when they do, the formal reference (or an empirical call) wins per the evidence hierarchy, but it's worth explicitly flagging the disagreement rather than picking one silently.
