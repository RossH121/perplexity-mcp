/**
 * outputSchema / structuredContent and the agent-file resources.
 *
 * The SDK Client validates structuredContent against outputSchema (Ajv) once
 * listTools() has cached the schemas, and throws when a typed tool's non-error
 * result lacks structuredContent. So every call here goes through a client that
 * has listed tools first; a passing callTool IS the validation. Each typed tool
 * is additionally re-validated with a standalone Ajv validator.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { AjvJsonSchemaValidator } from "@modelcontextprotocol/client/validators/ajv";

import { startServer, apiError, textOf } from "./helpers.mjs";
import { createOutputChecker } from "../build/server/outputValidation.js";
import { parseAgentFileUri, agentFileUri } from "../build/utils/agentFileUri.js";

const ajv = new AjvJsonSchemaValidator();

async function startTyped(fakes) {
	const s = await startServer(fakes);
	const { tools } = await s.client.listTools(); // caches the client-side validators
	s.schemas = Object.fromEntries(tools.filter((t) => t.outputSchema).map((t) => [t.name, t.outputSchema]));
	return s;
}

function assertValid(schemas, name, result) {
	assert.ok(!result.isError, `${name} unexpectedly errored: ${textOf(result)}`);
	assert.ok(result.structuredContent, `${name} returned no structuredContent`);
	const r = ajv.getValidator(schemas[name])(result.structuredContent);
	assert.ok(r.valid, `${name} structuredContent invalid: ${r.errorMessage}`);
	assert.ok(result.content.some((c) => c.type === "text" && c.text.length > 0), `${name} must keep a human-readable text block`);
}

const TYPED_TOOLS = [
	"decisions",
	"raw_search",
	"list_models",
	"list_skills",
	"list_filters",
	"agent_files",
	"embeddings",
	"contextualized_embeddings",
	"agent",
	"agent_retrieve",
	"get_model_info",
	"async_research_status",
	"async_research_list",
	"search",
];

/** [tool, args, fakes override, check(structuredContent)] -- every success branch of every typed tool. */
const HAPPY = [
	["decisions", { state: "x", questions: { defect: { type: "noul", instructions: "Defective?" } } }, {}, (sc) => {
		assert.equal(sc.answers.defect.type, "noul");
		assert.equal(typeof sc.answers.defect.noul, "number");
		assert.deepEqual(sc.missing_answers, []);
	}],
	["decisions", { state: "x", questions: { pick: { type: "choice", criteria: { a: "first", b: "second" } }, gone: { type: "noul", instructions: "q?" } }, mode: "web_grounding" }, {
		createDecision: async () => ({
			model: "pplx-decider-latest",
			answers: { pick: { type: "choice", choice: "a", confidence: 0.8, probabilities: { a: 0.8, b: "bad" } } },
			usage: { input_tokens: 10, output_tokens: 1, tool_calls_details: { search_web: { invocation: 2 } } },
			search_results: [{ title: "S", url: "https://s.example", snippet: "dropped" }, { title: "no url" }],
			fetched_results: [{ title: "F", url: "https://f.example", snippet: "abcd" }],
		}),
	}, (sc) => {
		assert.deepEqual(sc.answers.pick.probabilities, { a: 0.8 });
		assert.deepEqual(sc.missing_answers, ["gone"]);
		assert.deepEqual(sc.usage.tool_calls, { search_web: 2 });
		assert.equal(sc.search_results.length, 1);
		assert.equal(sc.search_results[0].snippet, undefined);
		assert.equal(sc.fetched_results[0].chars, 4);
		assert.ok(sc.estimated_cost_usd > 0.002);
	}],
	["raw_search", { query: "mcp spec" }, {}, (sc) => {
		assert.deepEqual(sc.queries, ["mcp spec"]);
		assert.equal(sc.count, 1);
		assert.equal(sc.results[0].url, "https://example.com/1");
	}],
	["raw_search", { query: ["a", "b"] }, { rawSearch: async () => [] }, (sc) => {
		assert.deepEqual(sc, { queries: ["a", "b"], count: 0, results: [] });
	}],
	["list_models", {}, {}, (sc) => {
		assert.equal(sc.count, 3);
		assert.equal(sc.provider_filter, null);
		assert.ok(sc.models.some((m) => m.id === "openai/gpt-5.1" && m.provider === "openai"));
	}],
	["list_models", { provider: "nobody" }, {}, (sc) => {
		assert.deepEqual(sc, { provider_filter: "nobody", count: 0, models: [] });
	}],
	["list_skills", {}, {}, (sc) => {
		assert.equal(sc.mode, "list");
		assert.equal(sc.skills[0].skill_id, "skill_abc123");
		assert.equal(sc.next_page_token, null);
	}],
	["list_skills", {}, { listSkills: async () => ({ skills: [], next_page_token: "tok" }) }, (sc) => {
		assert.deepEqual(sc, { mode: "list", skills: [], next_page_token: "tok" });
	}],
	["list_skills", { skill_id: "skill_abc123" }, {}, (sc) => {
		assert.equal(sc.mode, "get");
		assert.equal(sc.skill.description, "Apply the house style guide.");
	}],
	["list_filters", {}, {}, (sc) => {
		assert.deepEqual(sc, { allowed_domains: [], blocked_domains: [], recency: null, max_domains: 20 });
	}],
	["agent_files", { action: "list", response_id: "resp_1" }, {}, (sc) => {
		assert.equal(sc.action, "list");
		assert.equal(sc.files[0].uri, "perplexity-agent-file://resp_1/file_1");
	}],
	["agent_files", { action: "list", response_id: "resp_1" }, { listAgentFiles: async () => ({ data: [] }) }, (sc) => {
		assert.deepEqual(sc.files, []);
	}],
	["agent_files", { action: "content", response_id: "resp_1", file_id: "file_1" }, {}, (sc) => {
		assert.deepEqual(sc.file, {
			file_id: "file_1",
			filename: "report.pdf",
			bytes: 3,
			mime_type: "application/pdf",
			uri: "perplexity-agent-file://resp_1/file_1",
		});
	}],
	["embeddings", { input: "hello" }, {}, (sc) => {
		assert.equal(sc.count, 1);
		assert.equal(sc.dimensions, 1024);
		assert.equal(sc.dimensions_source, "model_default");
		assert.equal(sc.encoding, "base64_int8");
		assert.equal(sc.vectors, undefined);
	}],
	["embeddings", { input: ["a"], full: true, dimensions: 256, encoding_format: "base64_binary" }, {}, (sc) => {
		assert.deepEqual(sc.vectors, ["AAAA"]);
		assert.equal(sc.dimensions_source, "requested");
		assert.equal(sc.encoding, "base64_binary");
	}],
	["contextualized_embeddings", { input: [["a", "b"]] }, {}, (sc) => {
		assert.equal(sc.documents, 1);
		assert.equal(sc.chunks, 2);
	}],
	["contextualized_embeddings", { input: [["a", "b"]], full: true }, {}, (sc) => {
		assert.deepEqual(sc.vectors, [["AAAA", "BBBB"]]);
	}],
	["agent", { input: "do a task" }, {}, (sc) => {
		assert.equal(sc.output_text, "Agent answer.");
		assert.equal(sc.response_id, "resp_1");
		assert.equal(sc.cost_usd, null);
	}],
	["agent", { input: "rich" }, {
		agentRespond: async () => ({
			id: "resp_r",
			status: "completed",
			model: "anthropic/claude-sonnet-5-5",
			effort: "low@2026-11-11.0",
			service_tier: "flex",
			output: [
				{ type: "search_results", results: [{ id: 1, title: "T", url: "https://t.example" }] },
				{ type: "fetch_url_results", contents: [{ url: "https://f.example", title: "F" }] },
				{ type: "image_search_results", results: [{ image_url: "https://i.example/a.png", width: 10, height: "x" }] },
				{ type: "mcp_approval_request", id: "apr_1", server_label: "wiki", name: "ask", arguments: { q: 1 } },
				{ type: "share_file", file_id: "file_9", filename: "out.pdf", size_bytes: 12 },
				{ type: "share_file", error: "quota" },
				{ type: "image_search_results", results: [], error: "rate limited" },
				{ type: "mcp_list_tools", server_label: "wiki", tools: [{ name: "ask" }] },
				{ type: "mcp_call", server_label: "wiki", name: "ask", arguments: "{}", output: "x".repeat(600) },
				{ type: "message", content: [{ type: "output_text", text: "Rich." }] },
			],
			usage: { cost: { total_cost: 0.012 } },
		}),
	}, (sc) => {
		assert.equal(sc.output_text, "Rich.");
		assert.equal(sc.effort, "low@2026-11-11.0");
		assert.equal(sc.sources[0].url, "https://t.example");
		assert.equal(sc.images[0].height, null);
		assert.equal(sc.pending_approvals[0].id, "apr_1");
		assert.equal(sc.shared_files[0].uri, "perplexity-agent-file://resp_r/file_9");
		assert.equal(sc.shared_files[1].file_id, null);
		assert.equal(sc.shared_files[1].error, "quota");
		assert.deepEqual(sc.image_errors, ["rate limited"]);
		assert.deepEqual(sc.mcp_activity[0].tools, ["ask"]);
		assert.equal(sc.mcp_activity[1].kind, "call");
		assert.ok(sc.mcp_activity[1].output.length < 600);
		assert.equal(sc.cost_usd, 0.012);
	}],
	["agent", { input: "bg", background: true }, { agentRespond: async () => ({ id: "resp_q", status: "queued" }) }, (sc) => {
		assert.equal(sc.status, "queued");
		assert.equal(sc.output_text, "");
	}],
	["agent_retrieve", { response_id: "resp_1" }, {}, (sc) => {
		assert.equal(sc.output_text, "Retrieved answer.");
	}],
	["agent_retrieve", { response_id: "resp_x" }, {
		getAgentResponse: async (id) => ({ id, status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output_text: "Part" }),
	}, (sc) => {
		assert.equal(sc.status_detail, "reason: max_output_tokens");
	}],
	["search", { query: "latest node release" }, {}, (sc) => {
		assert.equal(sc.backend, "agent");
		assert.equal(sc.answer, "Synthesized answer.[1]");
		assert.equal(sc.effort, "fast@2026-11-11.0");
		assert.equal(sc.model_ran, "openai/gpt-6-luna");
		assert.equal(sc.sources[0].url, "https://example.com");
		assert.equal(sc.cost_usd, 0.0015);
	}],
	["search", { query: "q", stream: true, strip_thinking: true }, {}, (sc) => {
		assert.equal(sc.backend, "agent");
	}],
	["get_model_info", {}, {}, (sc) => {
		assert.equal(sc.current_model, "sonar-pro");
		assert.equal(sc.auto_selection, true);
		assert.ok(sc.available_models.some((m) => m.id === "sonar-deep-research" && m.keywords.length > 0));
	}],
	["async_research_status", { request_id: "resp_bg_1" }, {}, (sc) => {
		assert.equal(sc.backend, "agent");
		assert.equal(sc.done, true);
		assert.equal(sc.output_text, "Retrieved answer.");
	}],
	["async_research_status", { request_id: "resp_q" }, { getAgentResponse: async (id) => ({ id, status: "in_progress" }) }, (sc) => {
		assert.equal(sc.done, false);
		assert.equal(sc.output_text, "");
	}],
	["async_research_status", { request_id: "resp_f" }, { getAgentResponse: async (id) => ({ id, status: "failed", error: { message: "kaput" } }) }, (sc) => {
		assert.equal(sc.done, true);
		assert.equal(sc.error, "kaput");
	}],
	["async_research_status", { request_id: "req_1", strip_thinking: true }, {}, (sc) => {
		assert.equal(sc.backend, "legacy");
		assert.equal(sc.output_text, "Research report.");
		assert.equal(sc.sources[0].url, "https://example.com/s");
	}],
	["async_research_status", { request_id: "req_2" }, { getAsyncResearch: async (id) => ({ id, status: "IN_PROGRESS" }) }, (sc) => {
		assert.equal(sc.done, false);
	}],
	["async_research_status", { request_id: "req_3" }, { getAsyncResearch: async (id) => ({ id, status: "FAILED", error_message: "nope" }) }, (sc) => {
		assert.equal(sc.error, "nope");
	}],
	["async_research_list", {}, {}, (sc) => {
		assert.deepEqual(sc.jobs, []);
		assert.equal(sc.legacy_jobs[0].request_id, "req_1");
		assert.equal(sc.legacy_error, null);
	}],
	["async_research_list", {}, { listAsyncResearch: async () => { throw apiError(410, "gone"); } }, (sc) => {
		assert.match(sc.legacy_error, /gone/);
	}],
];

/** [tool, args, failing fake] -- API failure path per typed tool. */
const API_FAILURES = [
	["decisions", { state: "x", questions: { q: { type: "noul", instructions: "q?" } } }, "createDecision"],
	["raw_search", { query: "x" }, "rawSearch"],
	["list_models", {}, "listModels"],
	["list_skills", {}, "listSkills"],
	["list_skills", { skill_id: "skill_nope" }, "getSkill"],
	["agent_files", { action: "list", response_id: "resp_1" }, "listAgentFiles"],
	["agent_files", { action: "content", response_id: "resp_1", file_id: "f" }, "getAgentFileContent"],
	["embeddings", { input: "x" }, "createEmbeddings"],
	["contextualized_embeddings", { input: [["x"]] }, "createContextualizedEmbeddings"],
	["agent", { input: "x" }, "agentRespond"],
	["agent_retrieve", { response_id: "resp_1" }, "getAgentResponse"],
	["async_research_status", { request_id: "resp_1" }, "getAgentResponse"],
	["search", { query: "x" }, "agentSearch"],
	["async_research_status", { request_id: "req_1" }, "getAsyncResearch"],
];

/** Bad-argument path (thrown ToolInputError -> ErrorHandler.toToolResult). */
const BAD_ARGS = [
	["decisions", { state: "x" }],
	["raw_search", { query: "" }],
	["list_models", { provider: 5 }],
	["list_skills", { revision: "r" }],
	["agent_files", { action: "content", response_id: "resp_1" }],
	["embeddings", { input: "" }],
	["contextualized_embeddings", { input: [] }],
	["agent", {}],
	["agent_retrieve", {}],
	["async_research_status", {}],
	["search", {}],
];

describe("outputSchema declarations", () => {
	let s;
	before(async () => { s = await startTyped(); });
	after(async () => { await s.close(); });

	test("exactly the typed tools declare an outputSchema", () => {
		for (const t of TYPED_TOOLS) assert.ok(s.schemas[t], `${t} lacks outputSchema`);
	});

	test("schemas are root type:object with no root oneOf/anyOf/allOf, and compile", () => {
		for (const [name, schema] of Object.entries(s.schemas)) {
			assert.equal(schema.type, "object", name);
			for (const k of ["oneOf", "anyOf", "allOf", "not", "$ref"]) assert.equal(schema[k], undefined, `${name} has root ${k}`);
			assert.ok(Array.isArray(schema.required), name);
			for (const r of schema.required) assert.ok(schema.properties[r], `${name} requires undeclared ${r}`);
			ajv.getValidator(schema);
		}
	});
});

test("async_research_list carries jobs submitted in this process", async () => {
	const s = await startTyped();
	try {
		await s.client.callTool({ name: "async_research_submit", arguments: { query: "deep topic", search_mode: "academic" } });
		const st = await s.client.callTool({ name: "async_research_status", arguments: { request_id: "resp_bg_1" } });
		assertValid(s.schemas, "async_research_status", st);
		assert.ok(st.structuredContent.notes.length > 0, "submit-time backend notes reach status structuredContent");
		const r = await s.client.callTool({ name: "async_research_list", arguments: {} });
		assertValid(s.schemas, "async_research_list", r);
		assert.equal(r.structuredContent.jobs[0].request_id, "resp_bg_1");
		assert.equal(r.structuredContent.jobs[0].query, "deep topic");
	} finally {
		await s.close();
	}
});

describe("structuredContent happy paths validate (client + standalone Ajv)", () => {
	for (const [name, args, fakes, check] of HAPPY) {
		test(`${name} ${JSON.stringify(args).slice(0, 70)}`, async () => {
			const s = await startTyped(fakes);
			try {
				const result = await s.client.callTool({ name, arguments: args });
				assertValid(s.schemas, name, result);
				check(result.structuredContent);
			} finally {
				await s.close();
			}
		});
	}

	test("every typed tool has at least one happy-path case", () => {
		const covered = new Set(HAPPY.map(([n]) => n));
		for (const t of TYPED_TOOLS) assert.ok(covered.has(t), t);
	});
});

describe("search on the legacy Sonar backend", () => {
	before(() => { process.env.PERPLEXITY_SEARCH_BACKEND = "sonar"; });
	after(() => { delete process.env.PERPLEXITY_SEARCH_BACKEND; });

	for (const [label, args] of [["non-stream", { query: "q", effort: "low" }], ["stream", { query: "q", stream: true }]]) {
		test(label, async () => {
			const s = await startTyped({
				search: async () => ({
					choices: [{ message: { content: "Sonar answer." } }],
					search_results: [{ title: "E", url: "https://e.example" }],
					images: [{ image_url: "https://i.example/x.png", origin_url: "https://o.example" }],
					related_questions: ["why?"],
					usage: { cost: { total_cost: 0.004 } },
				}),
				searchStream: async () => ({ content: "Streamed.", search_results: [{ url: "https://s.example" }] }),
			});
			try {
				const r = await s.client.callTool({ name: "search", arguments: args });
				assertValid(s.schemas, "search", r);
				assert.equal(r.structuredContent.backend, "sonar");
				assert.deepEqual(r.structuredContent.notes, args.effort ? ["effort 'low' ignored, it is agent-backend only"] : []);
				if (args.stream) {
					assert.equal(r.structuredContent.answer, "Streamed.");
				} else {
					assert.deepEqual(r.structuredContent.related_questions, ["why?"]);
					assert.equal(r.structuredContent.images[0].image_url, "https://i.example/x.png");
					assert.equal(r.structuredContent.cost_usd, 0.004);
				}
			} finally {
				await s.close();
			}
		});
	}

	test("API failure and empty answer stay valid isError results", async () => {
		for (const fake of [async () => { throw apiError(500, "boom"); }, async () => ({ choices: [] })]) {
			const s = await startTyped({ search: fake });
			try {
				const r = await s.client.callTool({ name: "search", arguments: { query: "q" } });
				assert.equal(r.isError, true);
				assert.equal(r.structuredContent, undefined);
			} finally {
				await s.close();
			}
		}
	});
});

describe("error results stay valid for typed tools", () => {
	for (const [name, args, method] of API_FAILURES) {
		test(`${name} API failure (${method})`, async () => {
			const s = await startTyped({ [method]: async () => { throw apiError(500, "boom"); } });
			try {
				const result = await s.client.callTool({ name, arguments: args });
				assert.equal(result.isError, true);
				assert.equal(result.structuredContent, undefined);
				assert.match(textOf(result), /boom/);
			} finally {
				await s.close();
			}
		});
	}
	for (const [name, args] of BAD_ARGS) {
		test(`${name} invalid arguments`, async () => {
			const s = await startTyped();
			try {
				const result = await s.client.callTool({ name, arguments: args });
				assert.equal(result.isError, true, `${name} accepted ${JSON.stringify(args)}`);
				assert.equal(result.structuredContent, undefined);
			} finally {
				await s.close();
			}
		});
	}
	test("agent model-error enrichment is an isError result without structuredContent", async () => {
		const s = await startTyped({ agentRespond: async () => { throw apiError(400, 'model "openai/nope" is not supported'); } });
		try {
			const result = await s.client.callTool({ name: "agent", arguments: { input: "x", model: "openai/nope" } });
			assert.equal(result.isError, true);
			assert.equal(result.structuredContent, undefined);
			assert.match(textOf(result), /openai\/gpt-5\.1/);
		} finally {
			await s.close();
		}
	});
	test("agent_files content over the 5MB cap is an isError result", async () => {
		const s = await startTyped({
			getAgentFileContent: async () => ({ buffer: Buffer.alloc(5 * 1024 * 1024 + 1), contentType: "application/pdf", filename: "big.pdf" }),
		});
		try {
			const result = await s.client.callTool({ name: "agent_files", arguments: { action: "content", response_id: "r", file_id: "f" } });
			assert.equal(result.isError, true);
			assert.equal(result.structuredContent, undefined);
			assert.match(textOf(result), /over the 5 MB limit/);
		} finally {
			await s.close();
		}
	});
});

describe("server-side output check (createOutputChecker)", () => {
	const tools = [{ name: "t", outputSchema: { type: "object", properties: { n: { type: "number" } }, required: ["n"] } }, { name: "plain" }];
	const check = createOutputChecker(tools);

	test("passes valid, isError and untyped results through untouched", () => {
		const ok = { content: [{ type: "text", text: "x" }], structuredContent: { n: 1 } };
		assert.equal(check("t", ok), ok);
		const err = { content: [{ type: "text", text: "e" }], isError: true };
		assert.equal(check("t", err), err);
		const plain = { content: [{ type: "text", text: "p" }] };
		assert.equal(check("plain", plain), plain);
	});

	test("a schema mismatch or missing structuredContent becomes isError, text kept, structuredContent dropped", () => {
		for (const bad of [
			{ content: [{ type: "text", text: "answer" }], structuredContent: { n: "1" } },
			{ content: [{ type: "text", text: "answer" }] },
		]) {
			const out = check("t", bad);
			assert.equal(out.isError, true);
			assert.equal(out.structuredContent, undefined);
			assert.equal(out.content[0].text, "answer");
			assert.match(out.content.at(-1).text, /failed its outputSchema/);
		}
	});
});

describe("agent-file resources", () => {
	test("capabilities declare resources with listChanged", async () => {
		const s = await startTyped();
		try {
			assert.deepEqual(s.client.getServerCapabilities().resources, { listChanged: true });
		} finally {
			await s.close();
		}
	});

	test("resources/templates/list exposes the agent-file template", async () => {
		const s = await startTyped();
		try {
			const { resourceTemplates } = await s.client.listResourceTemplates();
			assert.equal(resourceTemplates.length, 1);
			assert.equal(resourceTemplates[0].uriTemplate, "perplexity-agent-file://{response_id}/{file_id}");
		} finally {
			await s.close();
		}
	});

	test("agent_files list returns resource_link blocks, fills resources/list and notifies list_changed", async () => {
		const s = await startTyped();
		try {
			let notified = 0;
			s.client.setNotificationHandler("notifications/resources/list_changed", () => { notified++; });
			assert.deepEqual((await s.client.listResources()).resources, []);

			const result = await s.client.callTool({ name: "agent_files", arguments: { action: "list", response_id: "resp_1" } });
			const links = result.content.filter((c) => c.type === "resource_link");
			assert.equal(links.length, 1);
			assert.equal(links[0].uri, "perplexity-agent-file://resp_1/file_1");
			assert.equal(links[0].name, "report.pdf");
			assert.equal(links[0].size, 3);

			const { resources } = await s.client.listResources();
			assert.deepEqual(resources.map((r) => r.uri), ["perplexity-agent-file://resp_1/file_1"]);
			// Listing again does not re-notify.
			await s.client.callTool({ name: "agent_files", arguments: { action: "list", response_id: "resp_1" } });
			await new Promise((r) => setImmediate(r));
			assert.equal(notified, 1);
		} finally {
			await s.close();
		}
	});

	test("resources/read returns a blob for binary, text for textual mime, and passes the signal", async () => {
		let mime = "application/pdf";
		const s = await startTyped({
			getAgentFileContent: async () => ({ buffer: Buffer.from("héllo"), contentType: mime, filename: "x" }),
		});
		try {
			const uri = "perplexity-agent-file://resp_1/file_1";
			const bin = await s.client.readResource({ uri });
			assert.equal(bin.contents[0].uri, uri);
			assert.equal(bin.contents[0].mimeType, "application/pdf");
			assert.equal(Buffer.from(bin.contents[0].blob, "base64").toString(), "héllo");

			mime = "text/csv; charset=utf-8";
			const txt = await s.client.readResource({ uri });
			assert.equal(txt.contents[0].text, "héllo");
			assert.equal(txt.contents[0].blob, undefined);

			const call = s.calls.find((c) => c.method === "getAgentFileContent");
			assert.deepEqual(call.args.slice(0, 2), ["file_1", "resp_1"]);
			assert.ok(call.args[2].signal instanceof AbortSignal);
		} finally {
			await s.close();
		}
	});

	test("agent_files content embeds the same resource contents as resources/read", async () => {
		const s = await startTyped();
		try {
			const viaTool = await s.client.callTool({ name: "agent_files", arguments: { action: "content", response_id: "resp_1", file_id: "file_1" } });
			const embedded = viaTool.content.find((c) => c.type === "resource").resource;
			const viaRead = await s.client.readResource({ uri: embedded.uri });
			assert.deepEqual(viaRead.contents[0], embedded);
		} finally {
			await s.close();
		}
	});

	// SDK v2 answers resource-not-found with -32602 on every era (2026-07-28 spec
	// MUST; a thrown -32002 is remapped at the encode seam). v1 sent -32002.
	test("resources/read errors: bad URI and API 404 -> not-found (-32602), oversized -> error mentioning the cap", async () => {
		let fail = null;
		const s = await startTyped({
			getAgentFileContent: async () => {
				if (fail === "404") throw apiError(404, "file not found");
				return { buffer: Buffer.alloc(5 * 1024 * 1024 + 1), contentType: "application/pdf" };
			},
		});
		try {
			for (const uri of ["perplexity-agent-file://only-one", "https://example.com/x", "perplexity-agent-file://a/b/c"]) {
				await assert.rejects(s.client.readResource({ uri }), (e) => e.code === -32602 && /Resource not found/.test(e.message), uri);
			}
			await assert.rejects(s.client.readResource({ uri: "perplexity-agent-file://r/f" }), /5 MB limit/);
			fail = "404";
			await assert.rejects(s.client.readResource({ uri: "perplexity-agent-file://r/f" }), (e) => e.code === -32602 && /Resource not found/.test(e.message));
		} finally {
			await s.close();
		}
	});

	test("URI helpers round-trip ids that need escaping", () => {
		const uri = agentFileUri("resp/1", "file 2");
		assert.deepEqual(parseAgentFileUri(uri), { responseId: "resp/1", fileId: "file 2" });
		assert.equal(parseAgentFileUri("perplexity-agent-file://%E0%A4%A/x"), null);
	});
});
