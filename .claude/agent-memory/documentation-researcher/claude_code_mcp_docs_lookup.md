---
name: claude-code-mcp-docs-lookup
description: Where Claude Code's MCP-client behaviour (anthropic/* _meta keys, output limits, annotations) is documented and how to read that oversized page
metadata:
  type: reference
---

https://code.claude.com/docs/en/mcp-configuration is the authoritative page for how Claude Code treats MCP servers. It covers `_meta["anthropic/maxResultSizeChars"]` and `anthropic/requiresUserInteraction`, the 50k-char persist-to-disk threshold, the idle timeout (30 min on stdio), auto-backgrounding after 2 min, the 4,096-char description/instructions truncation, and readOnlyHint meaning parallel execution. None of this is in the MCP spec.

The page is about 157k chars. WebFetch reads 100k at a time, and the second read with `offset: 100000` spilled to a tool-results file. Grepping that spilled file for keywords was faster than re-prompting. (2026-11-12)

For MCP TS SDK state, check the v1.x and v2 split first. `@modelcontextprotocol/sdk` 1.x is the maintenance line. v2 ships as `@modelcontextprotocol/server` and `/client`, and npm "latest" for the old package hides that v2 exists. Related: [[perplexity-node-sdk-lookup]]
