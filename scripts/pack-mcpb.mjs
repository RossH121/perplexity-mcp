#!/usr/bin/env node
/**
 * Builds the MCPB bundle: dist/mcpb/perplexity-mcp-<version>.mcpb
 *
 *   1. npm run build                       (tsc -> build/)
 *   2. gen-mcpb-manifest.mjs               (sync manifest.json version + tools from the built server)
 *   3. stage an allowlist into dist/mcpb/stage/  (manifest, package.json, lockfile, LICENSE, build/, .mcpbignore)
 *   4. npm ci --omit=dev --ignore-scripts  (clean production install inside the stage; no devDeps)
 *   5. mcpb validate + mcpb pack           (pinned CLI via npx)
 *   6. smoke test: mcpb unpack into a temp dir, then initialize + tools/list against
 *      the UNPACKED server (catches deps or files dropped by .mcpbignore)
 *
 * Usage: node scripts/pack-mcpb.mjs [--skip-build]
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { listTools } from "./gen-mcpb-manifest.mjs";

// Pinned: 2.1.2 was released 2025-12-04, well past the 7-day release-age gate.
const MCPB_CLI = "@anthropic-ai/mcpb@2.1.2";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "dist", "mcpb");
const stage = join(outDir, "stage");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

const run = (cmd, args, opts = {}) => {
	process.stderr.write(`$ ${cmd} ${args.join(" ")}\n`);
	execFileSync(cmd, args, { cwd: root, stdio: ["ignore", "inherit", "inherit"], ...opts });
};

if (!process.argv.includes("--skip-build")) run(npm, ["run", "build"]);
run(process.execPath, [join(root, "scripts", "gen-mcpb-manifest.mjs")]);

const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
if (manifest.version !== pkg.version) throw new Error("manifest.json version does not match package.json");

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
for (const entry of ["manifest.json", "package.json", "package-lock.json", "LICENSE", ".mcpbignore", "build"]) {
	if (!existsSync(join(root, entry))) throw new Error(`missing ${entry}; run npm run build first`);
	cpSync(join(root, entry), join(stage, entry), { recursive: true });
}

// Production-only install from the lockfile. --ignore-scripts matches this
// machine's policy and the server has no native deps that need install scripts.
run(npm, ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: stage });

const bundle = join(outDir, `${manifest.name}-${manifest.version}.mcpb`);
rmSync(bundle, { force: true });
run(npx, ["-y", MCPB_CLI, "validate", join(stage, "manifest.json")]);
run(npx, ["-y", MCPB_CLI, "pack", stage, bundle]);

const unpacked = mkdtempSync(join(tmpdir(), "mcpb-smoke-"));
try {
	run(npx, ["-y", MCPB_CLI, "unpack", bundle, unpacked]);
	const { init, tools } = await listTools(join(unpacked, "build", "index.js"), { cwd: unpacked });
	process.stderr.write(`unpacked bundle OK: ${init.serverInfo.name} v${init.serverInfo.version}, ${tools.length} tools\n`);
	if (tools.length !== manifest.tools.length) throw new Error("unpacked server tool count differs from manifest");
} finally {
	rmSync(unpacked, { recursive: true, force: true });
}

const mb = (statSync(bundle).size / 1024 / 1024).toFixed(2);
process.stderr.write(`\nBundle: ${bundle} (${mb} MB)\n`);
