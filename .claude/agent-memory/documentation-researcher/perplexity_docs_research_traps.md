---
name: perplexity-docs-research-traps
description: Perplexity changelog misses big deprecations (Sonar retirement 2026-09-27); how to grep oversized docs.perplexity.ai scrapes; live-probe via this repo's own MCP tools
metadata:
  type: reference
---

Learned 2026-11-12:

- **The changelog is not complete.** The Sonar Chat Completions end of support (2026-09-27) has no changelog entry. It appears only as a banner on `/docs/agent-api/migrate-from-sonar/overview` and on integration pages (AG2, Showcase). For deprecations, also check the migration pages, `community.perplexity.ai` announcements, and `firecrawl_map` with `search` (its page descriptions surfaced the dates quickly).
- **`/api-reference/sonar-post` now serves the migration page.** Legacy Sonar docs live under `/docs/legacy/sonar/*`.
- **Firecrawl scrapes of docs.perplexity.ai are too large to return inline** (changelog 273k chars, migration page 127k, mostly JSX) and spill to a one-line JSON file. Use Grep with `-o` and `[^\\]{0,300}KEYWORD[^\\]{0,300}`. Wide `.{0,1500}` windows come back as "[Omitted long matching line]". To list entry titles, use `(Month) 2026\\n\\n[A-Za-z ]{0,80}\\n\\n\*\*[^*]{0,80}\*\*`.
- **The `mcp__perplexity-mcp__*` tools are this repo's own server**, so calling them is a tier-1 empirical check of live API behaviour (it found that async only accepts `sonar-deep-research`, and that async still runs after its documented end of support). Keep probes cheap: `sonar`, small `max_tokens`, deep research at `minimal`.

Related: [[perplexity-node-sdk-lookup]]
