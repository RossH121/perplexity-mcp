/**
 * Wave 3 structure: read/write tool splits (get_model_info / set_model,
 * async_research_submit / _status / _list), deprecated aliases, per-call
 * search params (search_domain_filter, effort), single SearchHandler instance,
 * and the shared web_search builder.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { startServer, textOf } from "./helpers.mjs";
import { buildAgentSearchRequest } from "../build/services/agentSearchRequest.js";
import { buildWebSearchTool } from "../build/utils/agentRequest.js";

const agentBodies = (ctx) => ctx.calls.filter((c) => c.method === "agentSearch").map((c) => c.args[0]);

async function withServer(fn, fakes) {
	const ctx = await startServer(fakes);
	try {
		await fn(ctx);
	} finally {
		await ctx.close();
	}
}

describe("deprecated aliases", () => {
	test("alias descriptions start with 'DEPRECATED: use' and name the replacement", async () => {
		await withServer(async (ctx) => {
			const { tools } = await ctx.client.listTools();
			const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
			assert.match(byName.model_info.description, /^DEPRECATED: use get_model_info .*set_model/);
			assert.match(byName.async_research.description, /^DEPRECATED: use async_research_submit, async_research_status and async_research_list/);
			for (const name of ["domain_filter", "recency_filter", "clear_filters", "list_filters"]) {
				assert.match(byName[name].description, /^DEPRECATED:/, name);
			}
			for (const name of ["get_model_info", "set_model", "async_research_submit", "async_research_status", "async_research_list"]) {
				assert.doesNotMatch(byName[name].description, /DEPRECATED/, name);
			}
		});
	});

	test("split read tools are read-only + idempotent; the write tools are not", async () => {
		await withServer(async (ctx) => {
			const { tools } = await ctx.client.listTools();
			const a = Object.fromEntries(tools.map((t) => [t.name, t.annotations]));
			assert.deepEqual(a.get_model_info, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
			assert.deepEqual(a.set_model, { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false });
			assert.deepEqual(a.async_research_submit, { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true });
			for (const name of ["async_research_status", "async_research_list"]) {
				assert.deepEqual(a[name], { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }, name);
			}
		});
	});
});

describe("get_model_info / set_model", () => {
	test("get_model_info never changes the selection; set_model does; 'auto' resets", async () => {
		await withServer(async (ctx) => {
			await ctx.client.callTool({ name: "set_model", arguments: { model: "sonar-reasoning-pro" } });
			const info = textOf(await ctx.client.callTool({ name: "get_model_info", arguments: {} }));
			assert.match(info, /Current model: sonar-reasoning-pro/);
			assert.match(info, /Auto-selection: DISABLED/);
			// Calling get again (or with no arguments) still does not reset.
			await ctx.client.callTool({ name: "get_model_info" });
			await ctx.client.callTool({ name: "search", arguments: { query: "what is the capital of peru" } });
			assert.equal(agentBodies(ctx).at(-1).effort, "low", "sonar-reasoning-pro -> low");

			const reset = textOf(await ctx.client.callTool({ name: "set_model", arguments: { model: "auto" } }));
			assert.match(reset, /reset to default/);
			assert.match(textOf(await ctx.client.callTool({ name: "get_model_info", arguments: {} })), /Auto-selection: ENABLED/);
		});
	});

	test("model_info alias keeps its old behaviour (no args resets) and flags deprecation", async () => {
		await withServer(async (ctx) => {
			await ctx.client.callTool({ name: "set_model", arguments: { model: "sonar" } });
			const text = textOf(await ctx.client.callTool({ name: "model_info", arguments: {} }));
			assert.match(text, /reset to default/);
			assert.match(text, /model_info is deprecated; use get_model_info/);
			assert.match(textOf(await ctx.client.callTool({ name: "get_model_info", arguments: {} })), /Current model: sonar-pro/);
		});
	});

	test("set_model rejects unknown ids and a missing model", async () => {
		await withServer(async (ctx) => {
			for (const args of [{}, { model: "gpt-4" }]) {
				const r = await ctx.client.callTool({ name: "set_model", arguments: args });
				assert.equal(r.isError, true);
				assert.match(textOf(r), /Invalid set_model arguments/);
			}
		});
	});
});

describe("async_research split", () => {
	test("submit -> status -> list share one registry, and the alias sees it too", async () => {
		await withServer(async (ctx) => {
			const sub = textOf(await ctx.client.callTool({ name: "async_research_submit", arguments: { query: "tides", search_mode: "academic" } }));
			assert.match(sub, /Request ID: resp_bg_1/);
			assert.match(sub, /Poll with: async_research_status \{ request_id: "resp_bg_1" \}/);
			assert.doesNotMatch(sub, /deprecated/i);
			assert.equal(agentBodies(ctx)[0].background, true);

			const status = textOf(await ctx.client.callTool({ name: "async_research_status", arguments: { request_id: "resp_bg_1" } }));
			assert.match(status, /Retrieved answer\./);

			const list = textOf(await ctx.client.callTool({ name: "async_research_list", arguments: {} }));
			assert.match(list, /resp_bg_1: completed/);

			const legacy = textOf(await ctx.client.callTool({ name: "async_research", arguments: { action: "list" } }));
			assert.match(legacy, /resp_bg_1/);
			assert.match(legacy, /async_research is deprecated; use async_research_submit/);
		});
	});

	test("status rejects a missing request_id with a tool-specific message", async () => {
		await withServer(async (ctx) => {
			const r = await ctx.client.callTool({ name: "async_research_status", arguments: { request_id: "" } });
			assert.equal(r.isError, true);
			assert.match(textOf(r), /Invalid async_research_status arguments/);
		});
	});
});

describe("search per-call search_domain_filter", () => {
	test("overrides the stateful filter for one call without mutating it", async () => {
		await withServer(async (ctx) => {
			await ctx.client.callTool({ name: "domain_filter", arguments: { domain: "nodejs.org", action: "allow" } });
			await ctx.client.callTool({ name: "search", arguments: { query: "q", search_domain_filter: ["-pinterest.com", "-quora.com"] } });
			await ctx.client.callTool({ name: "search", arguments: { query: "q" } });
			await ctx.client.callTool({ name: "search", arguments: { query: "q", search_domain_filter: [] } });
			const [perCall, stateful, cleared] = agentBodies(ctx);
			assert.deepEqual(perCall.tools[0].filters.search_domain_filter, ["-pinterest.com", "-quora.com"]);
			assert.deepEqual(stateful.tools[0].filters.search_domain_filter, ["nodejs.org"]);
			assert.equal(cleared.tools, undefined, "[] means no domain filter for this call");
			assert.match(textOf(await ctx.client.callTool({ name: "list_filters", arguments: {} })), /Allowed domains: nodejs\.org/);
		});
	});

	test("parallel searches with different per-call filters do not cross-talk", async () => {
		await withServer(async (ctx) => {
			const domains = ["a.com", "b.com", "c.com", "d.com", "e.com"];
			await Promise.all(
				domains.map((d) => ctx.client.callTool({ name: "search", arguments: { query: `q ${d}`, search_domain_filter: [d] } }))
			);
			for (const body of agentBodies(ctx)) {
				const d = body.input.slice(2);
				assert.deepEqual(body.tools[0].filters.search_domain_filter, [d]);
			}
		});
	});

	test("mixed allow/exclude, over 20 domains and empty entries are rejected client-side", async () => {
		await withServer(async (ctx) => {
			const cases = [
				[["nodejs.org", "-pinterest.com"], /cannot mix/],
				[Array.from({ length: 21 }, (_, i) => `d${i}.com`), /at most 20/],
				[["-"], /non-empty/],
				["nodejs.org", /array of domain strings/],
			];
			for (const [filter, re] of cases) {
				const r = await ctx.client.callTool({ name: "search", arguments: { query: "q", search_domain_filter: filter } });
				assert.equal(r.isError, true, JSON.stringify(filter));
				assert.match(textOf(r), re);
			}
			assert.equal(agentBodies(ctx).length, 0);
		});
	});

	test("reaches the legacy Sonar body as search_domain_filter", async () => {
		process.env.PERPLEXITY_SEARCH_BACKEND = "sonar";
		try {
			await withServer(async (ctx) => {
				await ctx.client.callTool({ name: "search", arguments: { query: "q", search_domain_filter: ["arxiv.org"] } });
				const call = ctx.calls.find((c) => c.method === "search");
				assert.deepEqual(call.args[0].search_domain_filter, ["arxiv.org"]);
			});
		} finally {
			delete process.env.PERPLEXITY_SEARCH_BACKEND;
		}
	});
});

describe("search per-call effort", () => {
	test("bypasses keyword routing and set_model", async () => {
		await withServer(async (ctx) => {
			await ctx.client.callTool({ name: "set_model", arguments: { model: "sonar" } });
			const text = textOf(
				await ctx.client.callTool({ name: "search", arguments: { query: "a comprehensive deep research report", effort: "medium", search_type: "pro" } })
			);
			const body = agentBodies(ctx)[0];
			assert.equal(body.effort, "medium");
			assert.match(text, /\[Using effort override: medium \(ran fast@2026-11-11\.0 on openai\/gpt-6-luna\) - keyword routing bypassed\]/);
			assert.match(text, /search_type 'pro' did not change the effort/);
		});
	});

	test("accepts pinned versions, rejects malformed values, and yields to disable_search", async () => {
		await withServer(async (ctx) => {
			await ctx.client.callTool({ name: "search", arguments: { query: "q", effort: "high@latest" } });
			assert.equal(agentBodies(ctx)[0].effort, "high@latest");

			const bad = await ctx.client.callTool({ name: "search", arguments: { query: "q", effort: "High Effort" } });
			assert.equal(bad.isError, true);

			const text = textOf(await ctx.client.callTool({ name: "search", arguments: { query: "q", effort: "high", disable_search: true } }));
			assert.equal(agentBodies(ctx)[1].effort, undefined);
			assert.match(text, /effort 'high' was ignored because disable_search/);
		});
	});
});

describe("shared web_search builder", () => {
	test("buildAgentSearchRequest's web_search entry equals buildWebSearchTool on the mapped options", () => {
		const args = {
			search_after_date: "1/1/2026",
			search_before_date: "6/1/2026",
			last_updated_after: "2/1/2026",
			last_updated_before: "7/1/2026",
			search_context_size: "high",
			search_type: "fast",
			country: "US",
			city: "Austin",
			region: "TX",
			latitude: 30.27,
			longitude: -97.74,
		};
		const { body } = buildAgentSearchRequest({ sonarModel: "sonar-pro", query: "q", domainFilters: ["a.com"], args });
		assert.deepEqual(
			body.tools[0],
			buildWebSearchTool({
				search_domain_filter: ["a.com"],
				search_after_date_filter: "1/1/2026",
				search_before_date_filter: "6/1/2026",
				last_updated_after_filter: "2/1/2026",
				last_updated_before_filter: "7/1/2026",
				search_context_size: "high",
				search_type: "fast",
				user_location: { country: "US", city: "Austin", region: "TX", latitude: 30.27, longitude: -97.74 },
			})
		);
	});
});
