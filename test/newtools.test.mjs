import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { startServer, textOf, TEST_CONFIG } from "./helpers.mjs";
import { PerplexityApiService } from "../build/services/PerplexityApiService.js";
import { formatUsd } from "../build/utils/formatUsd.js";
import { estimateDecisionCost } from "../build/handlers/DecisionsHandler.js";

/** A real service whose SDK client methods are replaced, to inspect request bodies. */
function serviceWithClient(stubs) {
	const svc = new PerplexityApiService(TEST_CONFIG);
	const seen = [];
	for (const [path, impl] of Object.entries(stubs)) {
		const [resource, method] = path.split(".");
		svc.client[resource][method] = async (...args) => {
			seen.push({ path, args });
			return impl(...args);
		};
	}
	return { svc, seen };
}

describe("decisions", () => {
	test("renders choice, score, sources, fetched page and usage", async () => {
		const ctx = await startServer({
			createDecision: async () => ({
				model: "pplx-decider-flash-latest",
				answers: {
					sentiment: {
						type: "choice",
						choice: "mixed",
						confidence: 0.785,
						probabilities: { positive: 0.05, mixed: 0.857, negative: 0.093 },
					},
					severity: {
						type: "score",
						score: 1.47,
						confidence: 0.26,
						legend: { 0: "Cosmetic", 1: "Inconvenient", 2: "Unusable" },
						probabilities: { 0: 0.013, 1: 0.506, 2: 0.481 },
					},
				},
				usage: {
					input_tokens: 4441,
					output_tokens: 1,
					tool_calls_details: { search_web: { invocation: 1 }, fetch_url: { invocation: 1 } },
				},
				search_results: [{ title: "Node.js Releases", url: "https://nodejs.org/en/about/previous-releases", snippet: "...", date: "2026-10-29" }],
				fetched_results: [{ title: "Node.js Releases", url: "https://nodejs.org/en/about/previous-releases", snippet: "abc" }],
			}),
		});
		try {
			const result = await ctx.client.callTool({
				name: "decisions",
				arguments: {
					state: "https://nodejs.org/en/about/previous-releases",
					mode: "web_grounding",
					model: "pplx-decider-flash-latest",
					questions: {
						sentiment: { type: "choice", criteria: { positive: "a", mixed: null, negative: "c" } },
						severity: { type: "score", criteria: ["Cosmetic", "Inconvenient", "Unusable"] },
					},
				},
			});
			assert.equal(result.isError, undefined);
			const text = textOf(result);
			assert.match(text, /\*\*sentiment\*\* \(choice\): \*\*mixed\*\*/);
			assert.match(text, /mixed: 85\.7%/);
			assert.match(text, /\*\*severity\*\* \(score\): 1\.47 of 0-2 \(most likely: 1 = Inconvenient\)/);
			assert.match(text, /### Fetched page/);
			assert.match(text, /1\. \[Node\.js Releases\]\(https:\/\/nodejs\.org\/en\/about\/previous-releases\) \(2026-10-29\)/);
			assert.match(text, /4441 input tokens, 1 search_web, 1 fetch_url, est\. cost \$0\.002044/);
		} finally {
			await ctx.close();
		}
	});

	test("rejects malformed questions client-side with a specific message", async () => {
		const ctx = await startServer();
		try {
			const cases = [
				[{ state: "x", questions: {} }, /at least one named question/],
				[{ state: "x", questions: { a: { type: "choice" } } }, /\(choice\): 'criteria'/],
				[{ state: "x", questions: { a: { type: "score", criteria: [] } } }, /\(score\): 'criteria'/],
				[{ state: "x", questions: { a: { type: "noul" } } }, /needs 'instructions' or 'criteria'/],
				[{ state: "x", questions: { a: { type: "noul", instructions: "y", extra: 1 } } }, /unknown field/],
				[{ state: "x", mode: "web", questions: { a: { type: "noul", instructions: "y" } } }, /'mode'/],
				[{ state: "x", max_staleness: -1, questions: { a: { type: "noul", instructions: "y" } } }, /max_staleness/],
				[{ questions: { a: { type: "noul", instructions: "y" } } }, /'state' is required/],
			];
			for (const [args, pattern] of cases) {
				const result = await ctx.client.callTool({ name: "decisions", arguments: args });
				assert.equal(result.isError, true, JSON.stringify(args));
				assert.match(textOf(result), pattern);
			}
			assert.equal(ctx.calls.filter((c) => c.method === "createDecision").length, 0);
		} finally {
			await ctx.close();
		}
	});

	test("service sends mode/max_staleness only when set, and the default model", async () => {
		const { svc, seen } = serviceWithClient({ "decisions.create": async () => ({ answers: {} }) });
		const questions = { a: { type: "noul", instructions: "y?" } };
		await svc.createDecision({ state: "x", questions });
		await svc.createDecision({ state: "https://e.com", questions, mode: "web_grounding", max_staleness: 0, model: "pplx-decider-flash-latest" });
		assert.deepEqual(seen[0].args[0], { model: "pplx-decider-latest", state: "x", questions });
		assert.deepEqual(seen[1].args[0], {
			model: "pplx-decider-flash-latest",
			state: "https://e.com",
			questions,
			mode: "web_grounding",
			max_staleness: 0,
		});
	});

	test("cost estimate uses the per-model input rate plus $0.001 per tool call", () => {
		assert.equal(estimateDecisionCost("pplx-decider-latest", { input_tokens: 1e6 }), 0.02);
		assert.equal(estimateDecisionCost("pplx-decider-flash-v1.2", { input_tokens: 1e6 }), 0.01);
		assert.equal(estimateDecisionCost("x", {}), undefined);
	});
});

describe("list_skills", () => {
	test("empty project explains builtin skills and passes paging params", async () => {
		const ctx = await startServer({ listSkills: async () => ({ skills: [], next_page_token: "tok_2" }) });
		try {
			const result = await ctx.client.callTool({ name: "list_skills", arguments: { limit: 5, page_token: "tok_1" } });
			const text = textOf(result);
			assert.match(text, /No custom skills/);
			assert.match(text, /page_token "tok_2"/);
			const call = ctx.calls.find((c) => c.method === "listSkills");
			assert.deepEqual(call.args[0], { limit: 5, page_token: "tok_1" });
		} finally {
			await ctx.close();
		}
	});

	test("get passes skill_id and revision", async () => {
		const ctx = await startServer();
		try {
			await ctx.client.callTool({ name: "list_skills", arguments: { skill_id: "skill_x", revision: "rev_1" } });
			const call = ctx.calls.find((c) => c.method === "getSkill");
			assert.equal(call.args[0], "skill_x");
			assert.equal(call.args[1], "rev_1");
		} finally {
			await ctx.close();
		}
	});
});

describe("embeddings summary", () => {
	test("shows the effective encoding and a readable sub-cent cost", async () => {
		const ctx = await startServer({
			createEmbeddings: async () => ({
				model: "pplx-embed-v1-0.6b",
				data: [{ embedding: "AAAA" }],
				usage: { total_tokens: 2, cost: { currency: "USD", input_cost: 8e-9, total_cost: 8e-9 } },
			}),
		});
		try {
			const text = textOf(await ctx.client.callTool({ name: "embeddings", arguments: { input: "hi" } }));
			assert.match(text, /Cost: \$0\.000000008/);
			assert.match(text, /Encoding: base64_int8 \(API default\)/);
		} finally {
			await ctx.close();
		}
	});

	test("formatUsd", () => {
		assert.equal(formatUsd(8e-9), "$0.000000008");
		assert.equal(formatUsd(0.0123), "$0.0123");
		assert.equal(formatUsd(1.5), "$1.5");
		assert.equal(formatUsd(0), "$0");
	});
});
