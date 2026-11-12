#!/usr/bin/env node
/**
 * Regenerates the derived fields of manifest.json (MCPB bundle manifest):
 *   - version  <- package.json "version"
 *   - tools    <- live tools/list from the BUILT server (build/index.js)
 * Every other manifest field is hand-authored and left untouched.
 *
 * Usage:
 *   node scripts/gen-mcpb-manifest.mjs           # rewrite manifest.json
 *   node scripts/gen-mcpb-manifest.mjs --check   # exit 1 if manifest.json is stale
 *
 * Requires `npm run build` first. Runs the server with a dummy API key; no
 * network calls are made (initialize + tools/list only).
 */
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(root, "manifest.json");
const check = process.argv.includes("--check");

/** Spawn a stdio MCP server, run initialize + tools/list, return the tools. */
export async function listTools(entry, { cwd = root, env = {} } = {}) {
	const child = spawn(process.execPath, [entry], {
		cwd,
		env: { ...process.env, PERPLEXITY_API_KEY: "dummy-key-for-tools-list", ...env },
		stdio: ["pipe", "pipe", "pipe"],
	});
	let stderr = "";
	child.stderr.on("data", (d) => (stderr += d));

	const pending = new Map();
	let buf = "";
	child.stdout.on("data", (d) => {
		buf += d;
		let nl;
		while ((nl = buf.indexOf("\n")) >= 0) {
			const line = buf.slice(0, nl).trim();
			buf = buf.slice(nl + 1);
			if (!line) continue;
			const msg = JSON.parse(line);
			if (msg.id !== undefined && pending.has(msg.id)) {
				pending.get(msg.id)(msg);
				pending.delete(msg.id);
			}
		}
	});
	const exited = new Promise((_, reject) =>
		child.on("exit", (code) => reject(new Error(`server exited (code ${code}) before replying. stderr:\n${stderr}`))),
	);
	let nextId = 1;
	const request = (method, params) => {
		const id = nextId++;
		const reply = new Promise((resolve) => pending.set(id, resolve));
		child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
		const timeout = new Promise((_, reject) =>
			setTimeout(() => reject(new Error(`timeout waiting for ${method}. stderr:\n${stderr}`)), 15000).unref(),
		);
		return Promise.race([reply, exited, timeout]).then((msg) => {
			if (msg.error) throw new Error(`${method} failed: ${JSON.stringify(msg.error)}`);
			return msg.result;
		});
	};

	try {
		const init = await request("initialize", {
			protocolVersion: "2025-06-18",
			capabilities: {},
			clientInfo: { name: "gen-mcpb-manifest", version: "0" },
		});
		child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
		const tools = [];
		let cursor;
		do {
			const page = await request("tools/list", cursor ? { cursor } : {});
			tools.push(...page.tools);
			cursor = page.nextCursor;
		} while (cursor);
		return { init, tools };
	} finally {
		child.kill();
	}
}

async function main() {
	const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
	const currentText = readFileSync(manifestPath, "utf8");
	const manifest = JSON.parse(currentText);

	const { tools } = await listTools(join(root, "build", "index.js"));
	manifest.version = pkg.version;
	manifest.tools = tools.map((t) => ({ name: t.name, description: t.description ?? "" }));

	const nextText = JSON.stringify(manifest, null, 2) + "\n";
	if (check) {
		if (nextText !== currentText) {
			process.stderr.write(
				"manifest.json is stale (version or tools differ from package.json / built server).\n" +
					"Run: npm run build && node scripts/gen-mcpb-manifest.mjs\n",
			);
			process.exit(1);
		}
		process.stderr.write(`manifest.json up to date (v${pkg.version}, ${tools.length} tools)\n`);
		return;
	}
	writeFileSync(manifestPath, nextText);
	process.stderr.write(`manifest.json updated (v${pkg.version}, ${tools.length} tools)\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	main().catch((err) => {
		process.stderr.write(`${err.stack ?? err}\n`);
		process.exit(1);
	});
}
