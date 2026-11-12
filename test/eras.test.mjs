/**
 * Protocol-era coverage for the production entry (serveStdio, SDK v2).
 *
 * serveStdio serves both eras from one pinned server instance per connection:
 * - legacy: 2025-era `initialize` handshake (2024-10-07 ... 2025-11-25).
 * - modern: 2026-07-28, `server/discover` + a per-request `_meta` envelope,
 *   list_changed delivered only on a `subscriptions/listen` stream.
 *
 * The in-process half drives serveStdio over an in-memory transport with fake
 * services. The spawned half runs build/index.js over real stdio: a raw
 * JSON-RPC 2025-11-25 exchange (no SDK client) and an SDK client pinned to
 * 2026-07-28. Neither makes a network call.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import { startServer } from "./helpers.mjs";

const pkg = createRequire(import.meta.url)("../package.json");
const ENTRY = fileURLToPath(new URL("../build/index.js", import.meta.url));
const TOOL_COUNT = 22;

for (const era of ["legacy", "modern"]) {
	describe(`serveStdio, ${era} era (in-process)`, () => {
		test("negotiates the era and exposes identity, instructions and capabilities", async () => {
			const s = await startServer({}, { era });
			try {
				assert.equal(s.client.getProtocolEra(), era);
				assert.equal(
					s.client.getNegotiatedProtocolVersion(),
					era === "modern" ? "2026-07-28" : "2025-11-25"
				);
				assert.equal(s.client.getServerVersion().version, pkg.version);
				const instructions = s.client.getInstructions();
				assert.ok(instructions && instructions.length > 0 && instructions.length <= 4096);
				assert.deepEqual(s.client.getServerCapabilities().resources, { listChanged: true });
				assert.ok(s.client.getServerCapabilities().tools);
			} finally {
				await s.close();
			}
		});

		test("tools/list keeps titles, annotations, _meta and outputSchema", async () => {
			const s = await startServer({}, { era });
			try {
				const { tools } = await s.client.listTools();
				assert.equal(tools.length, TOOL_COUNT);
				const search = tools.find((t) => t.name === "search");
				assert.ok(search.title);
				assert.ok(search.annotations);
				assert.ok(search._meta?.["anthropic/maxResultSizeChars"] > 0);
				assert.ok(search.outputSchema);
			} finally {
				await s.close();
			}
		});

		test("filter state persists across calls on the pinned instance", async () => {
			const s = await startServer({}, { era });
			try {
				await s.client.callTool({ name: "domain_filter", arguments: { domain: "example.com", action: "allow" } });
				const listed = await s.client.callTool({ name: "list_filters", arguments: {} });
				assert.deepEqual(listed.structuredContent.allowed_domains, ["example.com"]);
			} finally {
				await s.close();
			}
		});

		test("error contract: bad args -> isError result; unknown tool -> -32602", async () => {
			const s = await startServer({}, { era });
			try {
				const bad = await s.client.callTool({ name: "search", arguments: {} });
				assert.equal(bad.isError, true);
				await assert.rejects(
					s.client.callTool({ name: "no_such_tool", arguments: {} }),
					(e) => e.code === -32602 && /Unknown tool/.test(e.message)
				);
			} finally {
				await s.close();
			}
		});

		test("client abort reaches the in-flight service call's signal", async () => {
			let sawAbort;
			const aborted = new Promise((resolve) => (sawAbort = resolve));
			const s = await startServer(
				{
					rawSearch: (_args, handlerCtx) =>
						new Promise((_resolve, reject) => {
							handlerCtx.signal.addEventListener("abort", () => {
								sawAbort(true);
								reject(new Error("aborted"));
							});
						}),
				},
				{ era }
			);
			try {
				const controller = new AbortController();
				const pending = s.client.callTool(
					{ name: "raw_search", arguments: { query: "slow" } },
					{ signal: controller.signal, timeout: 5000 }
				);
				setTimeout(() => controller.abort("user cancelled"), 20);
				await assert.rejects(pending, (e) => !/timed out/i.test(e.message));
				assert.equal(await aborted, true);
			} finally {
				await s.close();
			}
		});

		test("resources: template, read, and list_changed when agent_files grows the list", async () => {
			let notified = 0;
			const s = await startServer(
				{},
				{
					era,
					// Same option in both eras; on modern the SDK opens subscriptions/listen.
					clientOptions: {
						listChanged: { resources: { onChanged: () => notified++, debounceMs: 0, autoRefresh: false } },
					},
				}
			);
			try {
				const { resourceTemplates } = await s.client.listResourceTemplates();
				assert.equal(resourceTemplates[0].uriTemplate, "perplexity-agent-file://{response_id}/{file_id}");
				assert.deepEqual((await s.client.listResources()).resources, []);

				await s.client.callTool({ name: "agent_files", arguments: { action: "list", response_id: "resp_1" } });
				const deadline = Date.now() + 2000;
				while (notified === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
				assert.equal(notified, 1);

				const { resources } = await s.client.listResources();
				assert.deepEqual(resources.map((r) => r.uri), ["perplexity-agent-file://resp_1/file_1"]);
				const read = await s.client.readResource({ uri: resources[0].uri });
				assert.equal(read.contents[0].mimeType, "application/pdf");
			} finally {
				await s.close();
			}
		});
	});
}

/** Spawn build/index.js and speak newline-delimited JSON-RPC to it by hand. */
function spawnRaw() {
	const child = spawn(process.execPath, [ENTRY], {
		env: { ...process.env, PERPLEXITY_API_KEY: "pplx-test-dummy" },
		stdio: ["pipe", "pipe", "pipe"],
	});
	let buf = "";
	let stderr = "";
	const waiters = new Map();
	const nonJson = [];
	child.stderr.on("data", (d) => (stderr += d));
	child.stdout.on("data", (d) => {
		buf += d;
		let i;
		while ((i = buf.indexOf("\n")) >= 0) {
			const line = buf.slice(0, i);
			buf = buf.slice(i + 1);
			if (!line.trim()) continue;
			let msg;
			try {
				msg = JSON.parse(line);
			} catch {
				nonJson.push(line);
				continue;
			}
			if (msg.id !== undefined && waiters.has(msg.id)) {
				waiters.get(msg.id)(msg);
				waiters.delete(msg.id);
			}
		}
	});
	let nextId = 0;
	return {
		nonJson,
		get stderr() {
			return stderr;
		},
		request(method, params = {}) {
			const id = ++nextId;
			return new Promise((resolve, reject) => {
				const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 10_000);
				waiters.set(id, (m) => {
					clearTimeout(timer);
					resolve(m);
				});
				child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
			});
		},
		notify(method, params) {
			child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, ...(params ? { params } : {}) }) + "\n");
		},
		/** Close stdin; the server must exit on its own (stdin EOF). */
		async end() {
			child.stdin.end();
			return new Promise((resolve) => child.on("exit", resolve));
		},
	};
}

describe("spawned stdio server (build/index.js)", () => {
	test("raw JSON-RPC at 2025-11-25: initialize -> tools/list -> tools/call -> resources/templates/list", async () => {
		const p = spawnRaw();
		const init = await p.request("initialize", {
			protocolVersion: "2025-11-25",
			capabilities: {},
			clientInfo: { name: "raw-test", version: "0" },
		});
		assert.equal(init.result.protocolVersion, "2025-11-25");
		assert.equal(init.result.serverInfo.version, pkg.version);
		assert.ok(init.result.instructions.length > 0);
		assert.deepEqual(init.result.capabilities.resources, { listChanged: true });
		p.notify("notifications/initialized");

		const list = await p.request("tools/list");
		assert.equal(list.result.tools.length, TOOL_COUNT);

		const bad = await p.request("tools/call", { name: "search", arguments: {} });
		assert.equal(bad.result.isError, true);
		const ok = await p.request("tools/call", { name: "list_filters", arguments: {} });
		assert.equal(ok.result.isError, undefined);
		assert.deepEqual(ok.result.structuredContent.allowed_domains, []);
		const unknown = await p.request("tools/call", { name: "nope", arguments: {} });
		assert.equal(unknown.error.code, -32602);

		const templates = await p.request("resources/templates/list");
		assert.equal(templates.result.resourceTemplates.length, 1);

		assert.equal(await p.end(), 0);
		assert.deepEqual(p.nonJson, [], "stdout must carry only JSON-RPC");
		assert.equal(p.stderr, "");
	});

	test("raw JSON-RPC at 2026-07-28: server/discover, then stateless requests with the _meta envelope", async () => {
		const p = spawnRaw();
		const _meta = {
			"io.modelcontextprotocol/protocolVersion": "2026-07-28",
			"io.modelcontextprotocol/clientInfo": { name: "raw-test", version: "0" },
			"io.modelcontextprotocol/clientCapabilities": {},
		};
		const discover = await p.request("server/discover", { _meta });
		assert.ok(discover.result.supportedVersions.includes("2026-07-28"));
		assert.ok(discover.result.instructions.length > 0, "instructions ride on server/discover in the 2026 era");
		assert.deepEqual(discover.result.capabilities.resources, { listChanged: true });
		assert.equal(discover.result._meta["io.modelcontextprotocol/serverInfo"].version, pkg.version);

		const list = await p.request("tools/list", { _meta });
		assert.equal(list.result.tools.length, TOOL_COUNT);
		await p.request("tools/call", { name: "domain_filter", arguments: { domain: "example.com", action: "allow" }, _meta });
		const listed = await p.request("tools/call", { name: "list_filters", arguments: {}, _meta });
		assert.deepEqual(listed.result.structuredContent.allowed_domains, ["example.com"]);
		const templates = await p.request("resources/templates/list", { _meta });
		assert.equal(templates.result.resourceTemplates.length, 1);

		assert.equal(await p.end(), 0);
		assert.deepEqual(p.nonJson, []);
		assert.equal(p.stderr, "");
	});

	test("SDK client pinned to 2026-07-28 over StdioClientTransport", async () => {
		const client = new Client(
			{ name: "test-client", version: "0.0.0" },
			{ versionNegotiation: { mode: { pin: "2026-07-28" } } }
		);
		await client.connect(
			new StdioClientTransport({
				command: process.execPath,
				args: [ENTRY],
				env: { ...process.env, PERPLEXITY_API_KEY: "pplx-test-dummy" },
				stderr: "pipe",
			})
		);
		try {
			assert.equal(client.getProtocolEra(), "modern");
			assert.ok(client.getInstructions().length > 0);
			assert.equal((await client.listTools()).tools.length, TOOL_COUNT);
		} finally {
			await client.close();
		}
	});
});
