/**
 * search / raw_search / async_research: Sonar -> Agent API migration.
 * Unit tests for the request builder plus end-to-end tool calls against fakes.
 */

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import { startServer, textOf } from "./helpers.mjs";
import { buildAgentSearchRequest, sonarModelToEffort } from "../build/services/agentSearchRequest.js";

const build = (args = {}, extra = {}) =>
	buildAgentSearchRequest({ sonarModel: "sonar-pro", query: "q", args, ...extra });

describe("buildAgentSearchRequest", () => {
	test("maps every Sonar model to the official effort level", () => {
		assert.equal(sonarModelToEffort("sonar"), "fast");
		assert.equal(sonarModelToEffort("sonar-pro"), "fast");
		assert.equal(sonarModelToEffort("sonar-reasoning-pro"), "low");
		assert.equal(sonarModelToEffort("sonar-deep-research"), "high");
		assert.equal(build({}, { sonarModel: "sonar-deep-research" }).body.effort, "high");
	});

	test("a bare query sends effort only: no tools, no notes", () => {
		const { body, notes } = build();
		assert.deepEqual(body, { input: "q", effort: "fast" });
		assert.deepEqual(notes, []);
	});

	test("filters, location and context size go on the web_search tool", () => {
		const { body } = build(
			{
				last_updated_after: "1/1/2026",
				last_updated_before: "2/1/2026",
				country: "US",
				city: "Boston",
				search_context_size: "high",
				search_type: "fast",
			},
			{ domainFilters: ["nodejs.org", "-pinterest.com"], recencyFilter: "week" }
		);
		assert.deepEqual(body.tools, [
			{
				type: "web_search",
				filters: {
					search_domain_filter: ["nodejs.org", "-pinterest.com"],
					search_recency_filter: "week",
					last_updated_after_filter: "1/1/2026",
					last_updated_before_filter: "2/1/2026",
				},
				search_context_size: "high",
				search_type: "fast",
				user_location: { country: "US", city: "Boston" },
			},
		]);
	});

	test("explicit published-date filters win over recency (the API rejects both together)", () => {
		const { body, notes } = build({ search_after_date: "1/1/2026" }, { recencyFilter: "week" });
		assert.deepEqual(body.tools[0].filters, { search_after_date_filter: "1/1/2026" });
		assert.match(notes.join("\n"), /recency 'week' was ignored/);
	});

	test("generation controls are renamed, response_format gets a default name", () => {
		const { body } = build({
			max_tokens: 100,
			temperature: 0.1,
			top_p: 0.5,
			reasoning_effort: "minimal",
			language_preference: "es",
			response_format: { type: "json_schema", json_schema: { schema: { type: "object" } } },
		});
		assert.equal(body.max_output_tokens, 100);
		assert.equal(body.temperature, 0.1);
		assert.equal(body.top_p, 0.5);
		assert.deepEqual(body.reasoning, { effort: "minimal" });
		assert.equal(body.language_preference, "es");
		assert.equal(body.response_format.json_schema.name, "response");
		assert.equal(body.max_tokens, undefined);
	});

	test("search_type pro raises fast to low; auto is dropped with a note", () => {
		assert.equal(build({ search_type: "pro" }).body.effort, "low");
		assert.equal(build({ search_type: "pro" }, { sonarModel: "sonar-deep-research" }).body.effort, "high");
		const auto = build({ search_type: "auto" });
		assert.equal(auto.body.effort, "fast");
		assert.match(auto.notes.join("\n"), /search_type 'auto'/);
	});

	test("params with no Agent equivalent are reported, never sent", () => {
		const { body, notes } = build({
			search_language_filter: ["en"],
			stream_mode: "concise",
			image_results_enhanced_relevance: true,
			return_related_questions: true,
			stop: ["x"],
			enable_search_classifier: true,
		});
		for (const name of [
			"search_language_filter",
			"stream_mode",
			"image_results_enhanced_relevance",
			"return_related_questions",
			"stop",
			"enable_search_classifier",
		]) {
			assert.ok(notes.some((n) => n.startsWith(name)), `${name} note`);
			assert.equal(body[name], undefined, `${name} not sent`);
		}
	});

	test("search_mode academic uses an academic allowlist unless domain filters are set", () => {
		const acad = build({ search_mode: "academic" });
		const domains = acad.body.tools[0].filters.search_domain_filter;
		assert.ok(domains.includes("arxiv.org") && domains.length <= 20);
		const kept = build({ search_mode: "academic" }, { domainFilters: ["example.edu"] });
		assert.deepEqual(kept.body.tools[0].filters.search_domain_filter, ["example.edu"]);
		assert.match(kept.notes.join("\n"), /kept/);
	});

	test("search_mode sec adds finance_search and a sec.gov filter", () => {
		const { body } = build({ search_mode: "sec" });
		assert.deepEqual(body.tools, [
			{ type: "web_search", filters: { search_domain_filter: ["sec.gov"] } },
			{ type: "finance_search" },
		]);
	});

	test("return_images adds image_search with mapped filters", () => {
		const { body, notes } = build({
			return_images: true,
			image_format_filter: ["JPG", "png", "tiff"],
			image_domain_filter: Array.from({ length: 12 }, (_, i) => `d${i}.com`),
		});
		const image = body.tools.find((t) => t.type === "image_search");
		assert.deepEqual(image.filters.format_filter, ["jpeg", "png"]);
		assert.equal(image.filters.domain_filter.length, 10);
		assert.ok(body.tools.some((t) => t.type === "web_search"));
		assert.match(notes.join("\n"), /tiff/);
		assert.match(notes.join("\n"), /truncated/);
	});

	test("disable_search routes to a direct model with no tools", () => {
		const { body, effort, notes } = build({ disable_search: true, recency: "day" }, { recencyFilter: "day" });
		assert.equal(body.model, "perplexity/sonar");
		assert.equal(body.effort, undefined);
		assert.equal(body.tools, undefined);
		assert.equal(effort, undefined);
		assert.match(notes.join("\n"), /disable_search/);
	});
});

describe("search tool, agent backend (default)", () => {
	afterEach(() => {
		delete process.env.PERPLEXITY_SEARCH_BACKEND;
	});

	test("renders answer, Sources, cost footer and the effort mapping", async () => {
		const ctx = await startServer();
		try {
			const result = await ctx.client.callTool({ name: "search", arguments: { query: "latest node release", show_cost: true } });
			const text = textOf(result);
			assert.notEqual(result.isError, true, text);
			assert.match(text, /\[Using model: sonar-pro -> Agent effort fast \(ran fast@2026-11-11\.0 on openai\/gpt-6-luna\)/);
			assert.match(text, /Synthesized answer\.\[1\]/);
			assert.match(text, /## Sources\n\[1\] Example\nhttps:\/\/example\.com/);
			assert.match(text, /_Request cost: \$0\.001500_/);
			assert.doesNotMatch(text, /Backend notes/);
			const call = ctx.calls.find((c) => c.method === "agentSearch");
			assert.equal(call.args[0].effort, "fast");
			assert.equal(ctx.calls.some((c) => c.method === "search"), false);
		} finally {
			await ctx.close();
		}
	});

	test("keyword routing still picks the model, mapped through to effort", async () => {
		const ctx = await startServer();
		try {
			await ctx.client.callTool({ name: "search", arguments: { query: "a comprehensive deep research report on tides" } });
			assert.equal(ctx.calls.find((c) => c.method === "agentSearch").args[0].effort, "high");
		} finally {
			await ctx.close();
		}
	});

	test("stateful domain/recency filters reach the web_search tool", async () => {
		const ctx = await startServer();
		try {
			await ctx.client.callTool({ name: "domain_filter", arguments: { domain: "nodejs.org", action: "allow" } });
			await ctx.client.callTool({ name: "recency_filter", arguments: { filter: "month" } });
			await ctx.client.callTool({ name: "search", arguments: { query: "node lts" } });
			const body = ctx.calls.find((c) => c.method === "agentSearch").args[0];
			assert.deepEqual(body.tools[0].filters, { search_domain_filter: ["nodejs.org"], search_recency_filter: "month" });
		} finally {
			await ctx.close();
		}
	});

	test("dropped params are listed under Backend notes; images are rendered", async () => {
		const ctx = await startServer({
			agentSearch: async () => ({
				status: "completed",
				output: [
					{ type: "image_search_results", results: [{ image_url: "https://img.example/1.jpg", origin_url: "https://example.com", width: 1, height: 1 }] },
					{ type: "message", content: [{ type: "output_text", text: "Answer." }] },
				],
			}),
		});
		try {
			const result = await ctx.client.callTool({
				name: "search",
				arguments: { query: "eiffel tower", return_images: true, return_related_questions: true },
			});
			const text = textOf(result);
			assert.match(text, /## Images\n\[1\] https:\/\/img\.example\/1\.jpg/);
			assert.match(text, /## Backend notes\n- return_related_questions was ignored/);
		} finally {
			await ctx.close();
		}
	});

	test("a non-completed run with no text is an isError result with the status", async () => {
		const ctx = await startServer({
			agentSearch: async () => ({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [] }),
		});
		try {
			const result = await ctx.client.callTool({ name: "search", arguments: { query: "x" } });
			assert.equal(result.isError, true);
			assert.match(textOf(result), /No response content received \(status: incomplete, max_output_tokens\)/);
		} finally {
			await ctx.close();
		}
	});
});

describe("search tool, PERPLEXITY_SEARCH_BACKEND=sonar", () => {
	afterEach(() => {
		delete process.env.PERPLEXITY_SEARCH_BACKEND;
	});

	test("uses the legacy chat-completions path, including streaming", async () => {
		process.env.PERPLEXITY_SEARCH_BACKEND = "sonar";
		const ctx = await startServer();
		try {
			const plain = textOf(await ctx.client.callTool({ name: "search", arguments: { query: "x", search_mode: "academic" } }));
			assert.match(plain, /\[Using model: sonar-pro \(legacy Sonar backend\)/);
			assert.match(plain, /Synthesized answer\./);
			const streamed = textOf(await ctx.client.callTool({ name: "search", arguments: { query: "x", stream: true } }));
			assert.match(streamed, /Streamed answer\./);
			assert.equal(ctx.calls.some((c) => c.method === "agentSearch"), false);
			assert.equal(ctx.calls.find((c) => c.method === "search").args[0].search_mode, "academic");
		} finally {
			await ctx.close();
		}
	});
});

describe("async_research on Agent background mode", () => {
	afterEach(() => {
		delete process.env.PERPLEXITY_SEARCH_BACKEND;
	});

	test("submit queues a background run, list shows it, status polls responses.retrieve", async () => {
		const ctx = await startServer({
			getAgentResponse: async (id) => ({
				id,
				status: "completed",
				output: [
					{ type: "search_results", results: [{ id: 1, title: "Src", url: "https://s.example" }] },
					{ type: "message", content: [{ type: "output_text", text: "Report body." }] },
				],
			}),
		});
		try {
			const submitted = textOf(await ctx.client.callTool({
				name: "async_research",
				arguments: { action: "submit", query: "deep topic", reasoning_effort: "minimal", search_mode: "academic" },
			}));
			assert.match(submitted, /Request ID: resp_bg_1/);
			assert.match(submitted, /effort high/);
			assert.match(submitted, /deprecated/);
			const body = ctx.calls.find((c) => c.method === "agentSearch").args[0];
			assert.equal(body.background, true);
			assert.equal(body.effort, "high");
			assert.deepEqual(body.reasoning, { effort: "minimal" });

			const listed = textOf(await ctx.client.callTool({ name: "async_research", arguments: { action: "list" } }));
			assert.match(listed, /resp_bg_1: queued/);
			assert.match(listed, /lost on restart/);
			assert.match(listed, /Legacy async Sonar jobs\n- req_1/);

			const status = textOf(await ctx.client.callTool({ name: "async_research", arguments: { action: "status", request_id: "resp_bg_1" } }));
			assert.match(status, /## Job resp_bg_1\nStatus: completed/);
			assert.match(status, /Report body\./);
			assert.match(status, /\[1\] Src/);
			assert.match(status, /search_mode 'academic'/);
			assert.equal(ctx.calls.some((c) => c.method === "getAsyncResearch"), false);
		} finally {
			await ctx.close();
		}
	});

	test("a pending agent run reports not ready", async () => {
		const ctx = await startServer({ getAgentResponse: async (id) => ({ id, status: "in_progress" }) });
		try {
			const text = textOf(await ctx.client.callTool({ name: "async_research", arguments: { action: "status", request_id: "resp_x" } }));
			assert.match(text, /Status: in_progress/);
			assert.match(text, /Not ready yet/);
		} finally {
			await ctx.close();
		}
	});

	test("legacy (bare UUID) ids are polled through the legacy async endpoint", async () => {
		const ctx = await startServer();
		try {
			const id = "7c1444e1-61dc-41b4-b43c-497e201e7544";
			const text = textOf(await ctx.client.callTool({ name: "async_research", arguments: { action: "status", request_id: id, strip_thinking: true } }));
			assert.match(text, /Research report\./);
			assert.doesNotMatch(text, /hidden/);
			assert.equal(ctx.calls.find((c) => c.method === "getAsyncResearch").args[0], id);
		} finally {
			await ctx.close();
		}
	});

	test("list still works when the legacy list endpoint fails", async () => {
		const ctx = await startServer({
			listAsyncResearch: async () => {
				throw new Error("gone");
			},
		});
		try {
			const result = await ctx.client.callTool({ name: "async_research", arguments: { action: "list" } });
			assert.notEqual(result.isError, true);
			assert.match(textOf(result), /Legacy async job list unavailable: gone/);
		} finally {
			await ctx.close();
		}
	});

	test("legacy backend submits to async Sonar and rejects non-deep-research models", async () => {
		process.env.PERPLEXITY_SEARCH_BACKEND = "sonar";
		const ctx = await startServer();
		try {
			const ok = textOf(await ctx.client.callTool({ name: "async_research", arguments: { action: "submit", query: "q" } }));
			assert.match(ok, /Request ID: req_1/);
			assert.equal(ctx.calls.find((c) => c.method === "submitAsyncResearch").args[0].model, "sonar-deep-research");
			const bad = await ctx.client.callTool({ name: "async_research", arguments: { action: "submit", query: "q", model: "sonar" } });
			assert.equal(bad.isError, true);
			assert.match(textOf(bad), /only model 'sonar-deep-research'/);
		} finally {
			await ctx.close();
		}
	});
});

describe("raw_search limits", () => {
	test("search_type fast is accepted and forwarded", async () => {
		const ctx = await startServer();
		try {
			const result = await ctx.client.callTool({ name: "raw_search", arguments: { query: "x", search_type: "fast" } });
			assert.notEqual(result.isError, true);
			assert.equal(ctx.calls.find((c) => c.method === "rawSearch").args[0].search_type, "fast");
		} finally {
			await ctx.close();
		}
	});

	test("max_results: 50 with people, 20 otherwise; at most 5 queries", async () => {
		const ctx = await startServer();
		try {
			const call = (args) => ctx.client.callTool({ name: "raw_search", arguments: args });
			assert.notEqual((await call({ query: "x", search_type: "people", max_results: 50 })).isError, true);
			assert.equal((await call({ query: "x", search_type: "people", max_results: 51 })).isError, true);
			assert.equal((await call({ query: "x", max_results: 21 })).isError, true);
			assert.equal((await call({ query: "x", search_type: "fast", max_results: 21 })).isError, true);
			assert.notEqual((await call({ query: ["a", "b", "c", "d", "e"] })).isError, true);
			assert.equal((await call({ query: ["a", "b", "c", "d", "e", "f"] })).isError, true);
			assert.equal((await call({ query: ["a", " "] })).isError, true);
		} finally {
			await ctx.close();
		}
	});
});
