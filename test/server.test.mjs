import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { ProtocolErrorCode as ErrorCode } from "@modelcontextprotocol/client";

import { startServer, textOf, apiError } from "./helpers.mjs";

const pkg = createRequire(import.meta.url)("../package.json");

const EXPECTED_TOOLS = [
	"search",
	"raw_search",
	"async_research_submit",
	"async_research_status",
	"async_research_list",
	"async_research",
	"agent",
	"agent_retrieve",
	"agent_cancel",
	"agent_files",
	"embeddings",
	"contextualized_embeddings",
	"domain_filter",
	"recency_filter",
	"clear_filters",
	"list_filters",
	"get_model_info",
	"set_model",
	"model_info",
	"list_models",
	"decisions",
	"list_skills",
];

const LARGE_RESULT_TOOLS = ["search", "async_research_status", "async_research", "agent", "agent_retrieve"];

/** One happy-path call per tool, with a substring the rendered result must contain. */
const HAPPY_PATH = [
	["search", { query: "latest node release" }, "Synthesized answer."],
	// The agent backend (default) fetches in one call, so stream:true renders the same answer.
	["search", { query: "streamed question", stream: true }, "Synthesized answer."],
	["raw_search", { query: "mcp spec" }, "Result one"],
	["async_research", { action: "submit", query: "deep topic" }, "resp_bg_1"],
	["async_research", { action: "status", request_id: "resp_bg_1" }, "Retrieved answer."],
	["async_research", { action: "status", request_id: "req_1", strip_thinking: true }, "Research report."],
	["async_research", { action: "list" }, "req_1"],
	["async_research_submit", { query: "deep topic" }, "resp_bg_1"],
	["async_research_status", { request_id: "resp_bg_1" }, "Retrieved answer."],
	["async_research_status", { request_id: "req_1", strip_thinking: true }, "Research report."],
	["async_research_list", {}, "req_1"],
	["agent", { input: "do a task" }, "Agent answer."],
	["agent_retrieve", { response_id: "resp_1" }, "Retrieved answer."],
	["agent_cancel", { response_id: "resp_1" }, "cancelling"],
	["agent_files", { action: "list", response_id: "resp_1" }, "report.pdf"],
	["agent_files", { action: "content", response_id: "resp_1", file_id: "file_1" }, "Retrieved report.pdf"],
	["embeddings", { input: "hello" }, "Vectors: 1"],
	["contextualized_embeddings", { input: [["chunk a", "chunk b"]] }, "Chunks: 2"],
	["domain_filter", { domain: "example.com", action: "allow" }, "example.com"],
	["recency_filter", { filter: "week" }, "week"],
	["list_filters", {}, "example.com"],
	["clear_filters", {}, ""],
	["model_info", { model: "sonar" }, "sonar"],
	["model_info", {}, "reset to default"],
	["get_model_info", {}, "Current model: sonar-pro"],
	["set_model", { model: "sonar" }, "Model has been set to: sonar"],
	["set_model", { model: "auto" }, "reset to default"],
	["list_models", { provider: "openai" }, "openai/gpt-5.1"],
	[
		"decisions",
		{ state: "Battery died after two weeks.", questions: { defect: { type: "noul", instructions: "Defect?" } } },
		"P(yes) = 93.8%",
	],
	["list_skills", {}, "skill_abc123"],
	["list_skills", { skill_id: "skill_abc123" }, "Latest revision: rev_2"],
];

/** One invalid-argument call per tool that validates arguments. */
const INVALID_ARGS = [
	["search", {}],
	["raw_search", { query: "" }],
	["async_research", { action: "status" }],
	["async_research_submit", { query: " " }],
	["async_research_status", {}],
	["set_model", {}],
	["agent", { input: "" }],
	["agent_retrieve", {}],
	["agent_cancel", { response_id: "" }],
	["agent_files", { action: "content", response_id: "resp_1" }],
	["embeddings", {}],
	["contextualized_embeddings", { input: "not nested" }],
	["domain_filter", { domain: "example.com", action: "maybe" }],
	["recency_filter", { filter: "decade" }],
	["model_info", { model: "not-a-model" }],
	["list_models", { provider: 42 }],
	["decisions", { state: "x", questions: { a: { type: "binary", instructions: "y?" } } }],
	["list_skills", { revision: "rev_1" }],
];

describe("tools/list", () => {
	let ctx;
	before(async () => {
		ctx = await startServer();
	});
	after(() => ctx.close());

	test("returns every tool exactly once, in a stable order", async () => {
		const { tools } = await ctx.client.listTools();
		assert.deepEqual(
			tools.map((t) => t.name),
			EXPECTED_TOOLS
		);
	});

	test("every tool has a title, all four annotation hints and a valid object schema", async () => {
		const { tools } = await ctx.client.listTools();
		for (const tool of tools) {
			assert.ok(tool.title && tool.title.length > 0, `${tool.name} title`);
			for (const hint of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"]) {
				assert.equal(typeof tool.annotations?.[hint], "boolean", `${tool.name}.${hint}`);
			}
			assert.equal(tool.inputSchema.type, "object", `${tool.name} schema type`);
			assert.ok(tool.description.length < 4096, `${tool.name} description length`);
			for (const req of tool.inputSchema.required ?? []) {
				assert.ok(req in (tool.inputSchema.properties ?? {}), `${tool.name} required '${req}' is declared`);
			}
			if (Object.keys(tool.inputSchema.properties ?? {}).length === 0) {
				assert.equal(tool.inputSchema.additionalProperties, false, `${tool.name} zero-arg schema`);
			}
		}
	});

	test("read-only annotations match the documented rationale", async () => {
		const { tools } = await ctx.client.listTools();
		const byName = Object.fromEntries(tools.map((t) => [t.name, t.annotations]));
		for (const name of ["search", "raw_search", "embeddings", "contextualized_embeddings", "list_models", "list_filters", "agent_retrieve", "agent_files", "decisions", "list_skills", "async_research_status", "async_research_list", "get_model_info"]) {
			assert.equal(byName[name].readOnlyHint, true, `${name} should be read-only`);
		}
		for (const name of ["agent", "agent_cancel", "async_research", "async_research_submit", "domain_filter", "recency_filter", "clear_filters", "model_info", "set_model"]) {
			assert.equal(byName[name].readOnlyHint, false, `${name} should not be read-only`);
		}
		for (const name of ["domain_filter", "recency_filter", "clear_filters", "list_filters", "model_info", "get_model_info", "set_model"]) {
			assert.equal(byName[name].openWorldHint, false, `${name} is local state only`);
		}
	});

	test("large-payload tools raise anthropic/maxResultSizeChars", async () => {
		const { tools } = await ctx.client.listTools();
		for (const tool of tools) {
			const limit = tool._meta?.["anthropic/maxResultSizeChars"];
			if (LARGE_RESULT_TOOLS.includes(tool.name)) {
				assert.equal(limit, 500000, tool.name);
			} else {
				assert.equal(limit, undefined, tool.name);
			}
		}
	});
});

describe("initialize", () => {
	test("server version matches package.json and instructions fit Claude Code's 4,096-char limit", async () => {
		const ctx = await startServer();
		try {
			assert.equal(ctx.client.getServerVersion().version, pkg.version);
			const instructions = ctx.client.getInstructions();
			assert.ok(instructions && instructions.length > 0);
			assert.ok(instructions.length <= 4096, `instructions are ${instructions.length} chars`);
		} finally {
			await ctx.close();
		}
	});
});

describe("tools/call happy paths", () => {
	let ctx;
	before(async () => {
		ctx = await startServer();
	});
	after(() => ctx.close());

	for (const [name, args, expected] of HAPPY_PATH) {
		test(`${name} ${JSON.stringify(args)}`, async () => {
			// client.callTool validates the result against CallToolResultSchema,
			// as does the 1.32 server wrapper, so a malformed shape fails here.
			const result = await ctx.client.callTool({ name, arguments: args });
			assert.notEqual(result.isError, true, textOf(result));
			assert.ok(textOf(result).includes(expected), `expected ${JSON.stringify(expected)} in:\n${textOf(result)}`);
		});
	}

	test("agent_files content returns an embedded blob resource", async () => {
		const result = await ctx.client.callTool({
			name: "agent_files",
			arguments: { action: "content", response_id: "resp_1", file_id: "file_1" },
		});
		const resource = result.content.find((c) => c.type === "resource");
		assert.equal(resource.resource.mimeType, "application/pdf");
		assert.equal(Buffer.from(resource.resource.blob, "base64").toString(), "abc");
	});

	test("model_info with arguments omitted is accepted", async () => {
		const result = await ctx.client.callTool({ name: "model_info" });
		assert.notEqual(result.isError, true, textOf(result));
	});
});

describe("tools/call errors", () => {
	let ctx;
	before(async () => {
		ctx = await startServer({
			rawSearch: async () => {
				throw apiError(401, "Invalid API key");
			},
			search: async () => ({ choices: [] }),
			agentSearch: async () => ({ status: "completed", output: [] }),
		});
	});
	after(() => ctx.close());

	for (const [name, args] of INVALID_ARGS) {
		test(`invalid ${name} arguments come back as an isError result`, async () => {
			const result = await ctx.client.callTool({ name, arguments: args });
			assert.equal(result.isError, true);
			assert.match(textOf(result), /invalid/i);
		});
	}

	test("Perplexity API errors come back as isError results", async () => {
		const result = await ctx.client.callTool({ name: "raw_search", arguments: { query: "x" } });
		assert.equal(result.isError, true);
		assert.equal(textOf(result), "Perplexity API error: Invalid API key");
	});

	test("errors a handler throws are converted to isError results", async () => {
		const result = await ctx.client.callTool({ name: "search", arguments: { query: "x" } });
		assert.equal(result.isError, true);
		assert.match(textOf(result), /No response content received/);
	});

	test("unknown tool is a protocol error with InvalidParams", async () => {
		await assert.rejects(
			ctx.client.callTool({ name: "no_such_tool", arguments: {} }),
			(err) => err.code === ErrorCode.InvalidParams && /Unknown tool/.test(err.message)
		);
	});

	test("prototype keys are not treated as tool names", async () => {
		await assert.rejects(
			ctx.client.callTool({ name: "constructor", arguments: {} }),
			(err) => err.code === ErrorCode.InvalidParams
		);
	});
});

describe("agent model-error enrichment", () => {
	test("a rejected model id is reported with the current provider-filtered catalog", async () => {
		const ctx = await startServer({
			agentRespond: async () => {
				throw apiError(400, 'validation failed: model "openai/gpt-9000" is not supported');
			},
		});
		try {
			const result = await ctx.client.callTool({
				name: "agent",
				arguments: { input: "x", model: "openai/gpt-9000" },
			});
			assert.equal(result.isError, true);
			const text = textOf(result);
			assert.match(text, /is not supported/);
			assert.match(text, /openai\/gpt-5\.1/);
			assert.doesNotMatch(text, /anthropic\//);
		} finally {
			await ctx.close();
		}
	});
});

describe("cancellation", () => {
	test("every service call receives the request's AbortSignal", async () => {
		const ctx = await startServer();
		try {
			for (const [name, args] of HAPPY_PATH) {
				await ctx.client.callTool({ name, arguments: args });
			}
			const networkCalls = ctx.calls;
			assert.ok(networkCalls.length > 0);
			for (const { method, args } of networkCalls) {
				const last = args[args.length - 1];
				assert.ok(last?.signal instanceof AbortSignal, `${method} did not receive ctx.signal`);
			}
		} finally {
			await ctx.close();
		}
	});

	test("client-side abort aborts the in-flight service call", async () => {
		let sawAbort;
		const aborted = new Promise((resolve) => (sawAbort = resolve));
		const ctx = await startServer({
			rawSearch: (_args, handlerCtx) =>
				new Promise((_resolve, reject) => {
					handlerCtx.signal.addEventListener("abort", () => {
						sawAbort(true);
						reject(new Error("aborted"));
					});
				}),
		});
		try {
			const controller = new AbortController();
			// SDK v2 dropped callTool's result-schema argument: options are 2nd.
			const pending = ctx.client.callTool({ name: "raw_search", arguments: { query: "slow" } }, {
				signal: controller.signal,
				timeout: 5000, // fail fast if the abort is ever not wired through
			});
			setTimeout(() => controller.abort("user cancelled"), 20);
			await assert.rejects(pending, (e) => !/timed out/i.test(e.message));
			assert.equal(await aborted, true);
		} finally {
			await ctx.close();
		}
	});
});
