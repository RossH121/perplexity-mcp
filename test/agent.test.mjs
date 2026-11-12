/**
 * Agent API tool tests: request-body building in agentRespond() (with the SDK
 * client faked one level down), argument validation through the MCP client,
 * the shared renderAgentResponse() output, and list_models via the typed
 * client.models.list().
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { startServer, textOf, TEST_CONFIG } from "./helpers.mjs";
import { PerplexityApiService } from "../build/services/PerplexityApiService.js";
import { renderAgentResponse } from "../build/handlers/AgentHandler.js";
import { buildWebSearchTool, buildAgentInput } from "../build/utils/agentRequest.js";

/** A real service whose SDK client methods are replaced; returns the captured bodies. */
function serviceWithFakeClient() {
	const svc = new PerplexityApiService(TEST_CONFIG);
	const bodies = [];
	svc.client.responses.create = async (body) => {
		bodies.push(body);
		return { id: "resp_x", status: "completed", output_text: "ok" };
	};
	svc.client.models.list = async () => ({ object: "list", data: [{ id: "perplexity/sonar", owned_by: "perplexity" }] });
	return { svc, bodies };
}

async function bodyFor(args) {
	const { svc, bodies } = serviceWithFakeClient();
	await svc.agentRespond(args);
	return bodies[0];
}

describe("agentRespond request body", () => {
	test("bare input defaults to effort 'low' and never sends preset", async () => {
		const body = await bodyFor({ input: "hi" });
		assert.equal(body.effort, "low");
		assert.equal("preset" in body, false);
		assert.equal(body.input, "hi");
		assert.equal(body.stream, false);
	});

	test("preset is mapped to effort; effort wins when both are set", async () => {
		const aliased = await bodyFor({ input: "hi", preset: "fast" });
		assert.equal(aliased.effort, "fast");
		assert.equal("preset" in aliased, false);

		const both = await bodyFor({ input: "hi", preset: "fast", effort: "high@latest" });
		assert.equal(both.effort, "high@latest");
		assert.equal("preset" in both, false);
	});

	test("model or profile suppresses the default effort", async () => {
		const withModel = await bodyFor({ input: "hi", model: "openai/gpt-6-sol" });
		assert.equal("effort" in withModel, false);

		const withProfile = await bodyFor({ input: "hi", profile: { type: "custom", id: "profile_abc", version: "3" } });
		assert.equal("effort" in withProfile, false);
		assert.deepEqual(withProfile.profile, { type: "custom", id: "profile_abc", version: "3" });
	});

	test("web_search_options is merged into the web_search entry and implicitly enables it", async () => {
		const implicit = await bodyFor({
			input: "hi",
			tools: ["fetch_url"],
			web_search_options: {
				search_type: "web",
				max_results: 3,
				search_domain_filter: ["nodejs.org"],
				search_recency_filter: "year",
				user_location: { country: "US" },
			},
		});
		assert.deepEqual(implicit.tools, [
			{
				type: "web_search",
				search_type: "web",
				max_results: 3,
				user_location: { country: "US" },
				filters: { search_domain_filter: ["nodejs.org"], search_recency_filter: "year" },
			},
			{ type: "fetch_url" },
		]);

		// Already listed: merged in place, not duplicated.
		const listed = await bodyFor({ input: "hi", tools: ["image_search", "web_search"], web_search_options: { search_type: "fast" } });
		assert.deepEqual(listed.tools, [{ type: "image_search" }, { type: "web_search", search_type: "fast" }]);
	});

	test("mcp_servers carry require_approval; tool_choice and reasoning 'none' pass through", async () => {
		const body = await bodyFor({
			input: "hi",
			tool_choice: "required",
			reasoning_effort: "none",
			mcp_servers: [{ server_label: "dw", server_url: "https://mcp.example.com/mcp", require_approval: { always: { tool_names: ["write"] } } }],
		});
		assert.equal(body.tool_choice, "required");
		assert.deepEqual(body.reasoning, { effort: "none" });
		assert.deepEqual(body.tools, [
			{ type: "mcp", server_label: "dw", server_url: "https://mcp.example.com/mcp", require_approval: { always: { tool_names: ["write"] } } },
		]);
	});

	test("approval_responses become input items; empty input sends approvals only", async () => {
		const only = await bodyFor({
			input: "",
			previous_response_id: "resp_prev",
			approval_responses: [
				{ approval_request_id: "mcpr_1", approve: true },
				{ approval_request_id: "mcpr_2", approve: false, reason: "no" },
			],
		});
		assert.deepEqual(only.input, [
			{ type: "mcp_approval_response", approval_request_id: "mcpr_1", approve: true },
			{ type: "mcp_approval_response", approval_request_id: "mcpr_2", approve: false, reason: "no" },
		]);
		assert.equal(only.previous_response_id, "resp_prev");

		const withText = await bodyFor({
			input: "then summarise",
			previous_response_id: "resp_prev",
			approval_responses: [{ approval_request_id: "mcpr_1", approve: true }],
		});
		assert.equal(withText.input.length, 2);
		assert.deepEqual(withText.input[1], { type: "message", role: "user", content: [{ type: "input_text", text: "then summarise" }] });
	});

	test("images and files share one user message", async () => {
		const body = await bodyFor({
			input: "describe",
			images: ["https://example.com/a.png"],
			files: [{ file_url: "https://example.com/a.pdf" }, { file_data: "cGluZWFwcGxl", filename: "a.txt" }],
		});
		assert.deepEqual(body.input, [
			{
				type: "message",
				role: "user",
				content: [
					{ type: "input_text", text: "describe" },
					{ type: "input_image", image_url: "https://example.com/a.png" },
					{ type: "input_file", file_url: "https://example.com/a.pdf" },
					{ type: "input_file", file_data: "cGluZWFwcGxl", filename: "a.txt" },
				],
			},
		]);
	});

	test("custom skills are sent by id", async () => {
		const body = await bodyFor({
			input: "hi",
			skills: [{ type: "custom", id: "skill_1" }, { type: "custom", id: "skill_2", version: "4" }, { type: "builtin", name: "office/pdf" }],
		});
		assert.deepEqual(body.skills, [
			{ type: "custom", id: "skill_1" },
			{ type: "custom", id: "skill_2", version: "4" },
			{ type: "builtin", name: "office/pdf" },
		]);
	});

	test("listModels uses the typed client.models.list()", async () => {
		const { svc } = serviceWithFakeClient();
		const res = await svc.listModels();
		assert.equal(res.data[0].id, "perplexity/sonar");
	});
});

describe("agentRequest helpers", () => {
	test("buildWebSearchTool with no options is a bare entry", () => {
		assert.deepEqual(buildWebSearchTool(), { type: "web_search" });
		assert.deepEqual(buildWebSearchTool({ last_updated_after_filter: "1/1/2026" }), {
			type: "web_search",
			filters: { last_updated_after_filter: "1/1/2026" },
		});
	});

	test("buildAgentInput keeps a bare string when nothing is attached", () => {
		assert.equal(buildAgentInput("hello"), "hello");
	});
});

describe("agent argument validation", () => {
	let ctx;
	before(async () => {
		ctx = await startServer();
	});
	after(() => ctx.close());

	const INVALID = [
		[{ input: "x", effort: "low", profile: { type: "custom", id: "profile_1" } }, /cannot be combined with 'effort'/],
		[{ input: "x", preset: "fast", profile: { type: "custom", id: "profile_1" } }, /cannot be combined/],
		[{ input: "x", effort: "Not An Effort!" }, /'effort' must be an effort name/],
		[{ input: "x", max_steps: 501 }, /1 to 500/],
		[{ input: "x", max_steps: 0 }, /1 to 500/],
		[{ input: "x", tool_choice: "always" }, /'tool_choice'/],
		[{ input: "x", tools: ["web_search", "nope"] }, /'tools' entries/],
		[{ input: "x", web_search_options: { bogus: 1 } }, /Unknown 'web_search_options' key/],
		[{ input: "x", web_search_options: { max_results: 99 } }, /1 to 50/],
		[{ input: "x", web_search_options: { search_recency_filter: "week", search_after_date_filter: "1/1/2026" } }, /cannot be combined with search_after_date_filter/],
		[{ input: "x", approval_responses: [{ approval_request_id: "mcpr_1", approve: true }] }, /requires 'previous_response_id'/],
		[{ input: "x", previous_response_id: "r", approval_responses: [{ approval_request_id: "mcpr_1", approve: true, reason: "y" }] }, /only allowed when approve is false/],
		[{ input: "", previous_response_id: "r" }, /non-empty string/],
		[{ input: "x", files: [{ file_url: "https://e.com/a.pdf", file_data: "AAAA" }] }, /exactly one of/],
		[{ input: "x", files: [{ file_url: "http://e.com/a.pdf" }] }, /https/],
		[{ input: "x", skills: [{ type: "custom" }] }, /Custom skills need an 'id'/],
		[{ input: "x", mcp_servers: [{ server_label: "a", server_url: "https://e.com", require_approval: "sometimes" }] }, /require_approval/],
		[{ input: "x", reasoning_effort: "extreme" }, /'reasoning_effort'/],
	];

	for (const [args, pattern] of INVALID) {
		test(`rejects ${JSON.stringify(args)}`, async () => {
			const before = ctx.calls.length;
			const result = await ctx.client.callTool({ name: "agent", arguments: args });
			assert.equal(result.isError, true);
			assert.match(textOf(result), pattern);
			assert.equal(ctx.calls.length, before, "invalid args must not reach the service");
		});
	}

	const VALID = [
		{ input: "x", effort: "ultra" },
		{ input: "x", effort: "low@2026-11-11.0" },
		{ input: "x", effort: "medium@latest" },
		{ input: "x", preset: "wide-research" },
		{ input: "x", max_steps: 500 },
		{ input: "x", profile: { type: "custom", id: "profile_1" } },
		{ input: "x", tools: ["image_search"], tool_choice: "none", reasoning_effort: "max" },
		{ input: "", previous_response_id: "r", approval_responses: [{ approval_request_id: "mcpr_1", approve: false, reason: "no" }] },
		{ input: "x", mcp_servers: [{ server_label: "a", server_url: "https://e.com", require_approval: { never: { read_only: true } } }] },
	];

	for (const args of VALID) {
		test(`accepts ${JSON.stringify(args)}`, async () => {
			const result = await ctx.client.callTool({ name: "agent", arguments: args });
			assert.notEqual(result.isError, true, textOf(result));
		});
	}
});

describe("renderAgentResponse", () => {
	test("header shows model, effort echo and service tier", () => {
		const text = renderAgentResponse({
			id: "resp_1",
			model: "openai/gpt-6-luna",
			effort: "fast@2026-11-11.0",
			preset: "fast@2026-11-11.0",
			service_tier: "flex",
			status: "completed",
			output_text: "ok",
		});
		assert.match(text, /^\[Agent model: openai\/gpt-6-luna \| effort: fast@2026-11-11\.0 \| service_tier: flex\]/);
	});

	test("an approval-gated run lists pending calls with continuation instructions", () => {
		// Shape captured live 2026-11-12 (deepwiki, require_approval:"always"):
		// status is "completed" and there is no message item.
		const text = renderAgentResponse({
			id: "resp_gate",
			model: "openai/gpt-6-luna",
			status: "completed",
			output: [
				{ type: "mcp_list_tools", id: "mcpl_1", server_label: "deepwiki", tools: [{ name: "read_wiki_structure" }, { name: "ask_question" }] },
				{ type: "mcp_approval_request", id: "mcpr_1", server_label: "deepwiki", name: "read_wiki_structure", arguments: '{"repoName":"a/b"}' },
			],
		});
		assert.match(text, /awaiting MCP tool approval/);
		assert.match(text, /deepwiki\.read_wiki_structure \(approval_request_id: mcpr_1\)/);
		assert.match(text, /previous_response_id: "resp_gate"/);
		assert.match(text, /SAME mcp_servers/);
		assert.match(text, /deepwiki: 2 tool\(s\) available \(read_wiki_structure, ask_question\)/);
		assert.doesNotMatch(text, /no text output/);
	});

	test("mcp_call, image_search_results and share_file are rendered", () => {
		const text = renderAgentResponse({
			id: "resp_2",
			status: "completed",
			output_text: "Done.",
			output: [
				{ type: "mcp_call", id: "mcp_1", server_label: "deepwiki", name: "read_wiki_structure", arguments: "{}", output: "x".repeat(2000) },
				{ type: "mcp_call", id: "mcp_2", server_label: "deepwiki", name: "ask_question", arguments: "{}", error: "boom" },
				{ type: "image_search_results", results: [{ image_url: "https://i.example/e.jpg", origin_url: "https://example.com/e", width: 800, height: 600, title: "Eiffel" }] },
				{ type: "image_search_results", results: [], error: "image_search_failed" },
				{ type: "share_file", call_id: "c1", file_id: "file_9", filename: "report.pdf", size_bytes: 1234 },
				{ type: "share_file", call_id: "c2", filename: "broken.txt", error: "too large" },
			],
		});
		assert.match(text, /call deepwiki\.read_wiki_structure\(\{\}\)/);
		assert.match(text, /more chars\)/, "long MCP output is truncated");
		assert.match(text, /error: boom/);
		assert.match(text, /## Images\n1\. \[Eiffel\]\(https:\/\/i\.example\/e\.jpg\) \(800x600\)\n   source: https:\/\/example\.com\/e/);
		assert.match(text, /image search error: image_search_failed/);
		assert.match(text, /report\.pdf, 1234 bytes \(file_id: file_9\)/);
		assert.match(text, /broken\.txt: failed to share: too large/);
		assert.match(text, /agent_files \{ action: "content", response_id: "resp_2"/);
	});

	test("incomplete runs surface the reason", () => {
		const text = renderAgentResponse({ id: "r", status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [] });
		assert.match(text, /\[status: incomplete, reason: max_output_tokens\]/);
	});

	test("failed runs surface the error", () => {
		const text = renderAgentResponse({ id: "r", status: "failed", error: { message: "upstream exploded", code: "server_error" }, output: [] });
		assert.match(text, /\[status: failed, error: upstream exploded \(server_error\)\]/);
	});

	test("a paused in-progress run shows the pause and polling hint", () => {
		const text = renderAgentResponse({ id: "r", status: "in_progress", paused: { reason: "token_limit" }, output: [] });
		assert.match(text, /Agent run status: in_progress \(paused: token_limit\)/);
		assert.match(text, /Poll with agent_retrieve/);
	});
});

describe("agent tool schemas", () => {
	let ctx;
	before(async () => {
		ctx = await startServer();
	});
	after(() => ctx.close());

	test("effort is a free string, tools include image_search, and stale model ids are gone", async () => {
		const { tools } = await ctx.client.listTools();
		const agent = tools.find((t) => t.name === "agent");
		const props = agent.inputSchema.properties;
		assert.equal(props.effort.type, "string");
		assert.equal(props.effort.enum, undefined);
		assert.equal(props.preset.enum, undefined);
		assert.ok(props.tools.items.enum.includes("image_search"));
		assert.deepEqual(props.tool_choice.enum, ["none", "auto", "required"]);
		assert.ok(props.reasoning_effort.enum.includes("none"));
		for (const key of ["profile", "files", "web_search_options", "approval_responses"]) assert.ok(props[key], key);
		assert.match(props.max_steps.description, /1-500/);
		for (const t of tools.filter((x) => x.name === "agent" || x.name === "list_models")) {
			const json = JSON.stringify(t);
			assert.doesNotMatch(json, /openai\/gpt-5'|claude-sonnet-4-6/, `${t.name} still cites a stale model id`);
		}
		const listModels = tools.find((t) => t.name === "list_models");
		assert.doesNotMatch(listModels.description, /Returns Sonar models/);
	});
});
