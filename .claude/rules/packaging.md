---
paths:
  - "manifest.json"
  - ".mcpbignore"
  - "scripts/pack-mcpb.mjs"
  - "scripts/gen-mcpb-manifest.mjs"
  - "Dockerfile"
  - "smithery.yaml"
---

# Packaging (MCPB, Docker, Smithery)

- `npm run pack:mcpb` builds, regenerates the manifest, stages an allowlist, does a production-only install (`npm ci --omit=dev --ignore-scripts`), validates and packs with the CLI pinned to `@anthropic-ai/mcpb@2.1.2`, then unpacks the bundle and runs `initialize` + `tools/list` on the unpacked copy. Test the unpacked copy, because the staged folder can pass while the bundle is broken
- In `manifest.json`, only `version` and `tools` are generated (`npm run mcpb:manifest`, with `--check` to detect drift). The rest is hand-written
- Every optional `user_config` field needs a `default`: Claude Desktop leaves an unset `${user_config.x}` as that literal string in the env var. Booleans arrive as the strings `"true"`/`"false"`, and the logger treats any non-empty value as on, so `debug` is a string defaulting to `""`
- `.mcpbignore` uses gitignore syntax, so an unanchored `dist/` also strips every `node_modules/*/dist` and breaks the bundle. Root-only entries start with `/`
- The server reads `package.json` two folders up from `build/config/` at runtime, so it must stay at the bundle root
- Claude Desktop runs on macOS and Windows only. On Linux, Claude Code pointed at `build/index.js` is the main install path
- Node 20 or newer is required (`engines`). Keep the Dockerfile's base image on a supported Node version
