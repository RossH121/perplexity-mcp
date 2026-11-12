---
paths:
  - "test/**"
  - "scripts/validate-params.mjs"
---

# Tests

- `test/helpers.mjs` `startServer(fakes, { era })` builds a real `PerplexityApiService` with a dummy key, swaps its network methods for fakes (`defaultFakes()`), and records every call in `calls`. The unit tests never hit the network; `scripts/validate-params.mjs` is the live check
- With no `era`, the harness uses the 2025 handshake. `era: "legacy" | "modern"` goes through the production `serveStdio` path, with `"modern"` pinning the client to 2026-07-28. `test/eras.test.mjs` covers both eras in-process and over a real spawned stdio process
- When adding a tool, add it to `EXPECTED_TOOLS`, add a `HAPPY_PATH` entry whose fake returns the real API shape (results are validated against `CallToolResultSchema`), and add an `INVALID_ARGS` entry. A typed tool also needs cases in `test/output.test.mjs`: one per success branch, plus an API failure and bad arguments. The signal test then checks the new service method gets `ctx.signal`
- v2 client traps: `callTool(params, options)` has no middle argument, so a v1-style `callTool(p, undefined, { signal })` silently drops the signal and the test only passes by timing out. `setNotificationHandler` takes a method string. `listChanged` handlers debounce 300ms
- `validate-params.mjs` runs the DeepWiki MCP approval round-trip by default (`PROBE_APPROVAL_MCP_URL=skip` turns it off). Get the key without printing it, e.g. from your MCP config with `jq`
