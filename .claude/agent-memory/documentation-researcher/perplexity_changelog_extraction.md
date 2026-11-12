---
name: perplexity-changelog-extraction
description: Cheapest reliable way to read the docs.perplexity.ai changelog and Agent API reference without Bash (WebFetch on .md pages, firecrawl_map discovery, cheap agent probes)
metadata:
  type: reference
---

Learned 2026-11-12 (Agent API / embeddings audit). This complements [[perplexity-docs-research-traps]], which covers the grep workarounds for oversized scrapes.

- **Skip the Firecrawl scrape of the changelog.** WebFetch on `https://docs.perplexity.ai/docs/resources/changelog` with a month-scoped prompt ("every entry dated October 2026") returned all 15 entries. Newest entries come first, so truncation only drops old ones. WebFetch caps verbatim quotes at about 125 chars, so expect paraphrase plus short quotes.
- **For field-level facts, use the `.md` variants** (`/api-reference/agent-post.md`, `/docs/agent-api/effort.md`, `/docs/agent-api/tools/mcp.md`) with a prompt naming the exact fields to confirm or deny. Ask explicitly "not present in schema?", because that is how the dropped `preset` showed up.
- **One `firecrawl_map` of docs.perplexity.ai (limit 400) per audit** surfaces new products (Decisions, Batch/Files, Profiles, Skills management, Connectors, Orchestrator) whose existence the changelog only partly tags.
- **Agent probes through `mcp__perplexity-mcp__agent`**: use `max_output_tokens` 16-32, plus `max_steps: 1` for heavy effort levels. They settled whether `preset` still works, whether `wide-research` still works, and whether supposedly retired model IDs still serve. A reasoning model at 16 tokens returns `status: incomplete`, which is still proof the ID is served.
- **`/v1/models` lags retirements**: it still listed `openai/gpt-5*` after their announced 2026-10-24 retirement. Don't treat the catalog as proof of documented support.

Related: [[perplexity-node-sdk-lookup]]
