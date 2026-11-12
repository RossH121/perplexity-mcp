#!/usr/bin/env node
/**
 * Live validation of request params against the Perplexity API.
 *
 * Why this exists: PerplexityApiService invokes the SDK through `as Function` /
 * `as any` casts, so TypeScript never checks request-body field names. And the
 * SDK's own generated types have been observed wrong in BOTH directions:
 *   - they list `search_mode` on /search, which the API rejects with a 400
 *   - they omit reasoning effort "max", which the API accepts
 * So the only trustworthy check is an actual call. Run this after adding or
 * renaming any request param.
 *
 * Usage:  PERPLEXITY_API_KEY=... node scripts/validate-params.mjs
 *         PERPLEXITY_API_KEY=... node scripts/validate-params.mjs --include-costly
 *         PROBE_MCP_URL=https://... [PROBE_MCP_TOKEN=...] PERPLEXITY_API_KEY=... node scripts/validate-params.mjs
 *
 * Each check reports PASS (accepted), FAIL (rejected), or SKIP. A FAIL means
 * the field name/shape is wrong and would be silently broken in production.
 *
 * --include-costly additionally runs: service_tier:"priority" (2x token price)
 * and a sandbox agent run that writes and retrieves a file (agent_files
 * round-trip), both spend more tokens/time than the rest of the suite.
 * It also runs a legacy async sonar-deep-research submit (~$0.01).
 *
 * Legacy Sonar canaries print OK or LOST instead of PASS/FAIL: LOST means a
 * Sonar-only feature stopped working (usually reformulation onto the Agent
 * API reached that model). It is informational and does not fail the run.
 */

import Perplexity from "@perplexity-ai/perplexity_ai";

const apiKey = process.env.PERPLEXITY_API_KEY;
if (!apiKey) {
	console.error("PERPLEXITY_API_KEY is not set.");
	process.exit(2);
}

const includeCostly = process.argv.includes("--include-costly");
const client = new Perplexity({ apiKey, timeout: 300000 });

let pass = 0;
let fail = 0;
let skip = 0;

async function check(name, fn) {
	process.stdout.write(`  ${name.padEnd(52)} `);
	try {
		const result = await fn();
		console.log("PASS");
		pass++;
		return result;
	} catch (err) {
		const msg = String(err?.message ?? err).replace(/\s+/g, " ").slice(0, 160);
		console.log(`FAIL  ${msg}`);
		fail++;
		return null;
	}
}

function skipped(name, why) {
	console.log(`  ${name.padEnd(52)} SKIP  ${why}`);
	skip++;
}

console.log("\nSearch API (/search)");

await check("search_context_size", () =>
	client.search.create({
		query: "perplexity api",
		max_results: 1,
		search_context_size: "low",
	})
);

// Guard against regression: this param must stay OUT of rawSearch().
await check("search_mode is still rejected (expected-reject)", async () => {
	try {
		await client.search.create({
			query: "perplexity api",
			max_results: 1,
			search_mode: "academic",
		});
	} catch {
		return true; // rejection is the pass condition
	}
	throw new Error("search_mode was ACCEPTED - the API changed; re-add it to raw_search");
});

// --- raw_search additions (search_type fast, people cap, multi-query cap) ---

const snippetChars = (r) => (r?.results ?? []).reduce((n, x) => n + (x.snippet?.length ?? 0), 0);

await check("search_type: fast", () =>
	client.search.create({ query: "perplexity api", max_results: 1, search_type: "fast" })
);

await check("people search max_results: 50", async () => {
	const r = await client.search.create({ query: "machine learning researcher", search_type: "people", max_results: 50 });
	if ((r.results ?? []).length <= 20) throw new Error(`only ${(r.results ?? []).length} results; the 50 cap may be gone`);
});

await check("max_results 21 without people (expected-reject)", async () => {
	try {
		await client.search.create({ query: "perplexity api", max_results: 21 });
	} catch {
		return true;
	}
	throw new Error("max_results 21 was ACCEPTED; relax the 20 cap in isValidRawSearchArgs");
});

await check("6 queries in one request (expected-reject)", async () => {
	try {
		await client.search.create({ query: ["a", "b", "c", "d", "e", "f"], max_results: 1 });
	} catch {
		return true;
	}
	throw new Error("6 queries were ACCEPTED; relax MAX_RAW_SEARCH_QUERIES in validation.ts");
});

// search_context_size is gone from the /search reference but still had an
// effect on 2026-11-12. If low stops returning less content than high,
// remove the param from raw_search and point at max_tokens_per_page.
await check("search_context_size still has an effect", async () => {
	const q = "history of the printing press";
	const low = await client.search.create({ query: q, max_results: 5, search_context_size: "low" });
	const high = await client.search.create({ query: q, max_results: 5, search_context_size: "high" });
	if (snippetChars(low) >= snippetChars(high)) {
		throw new Error(`low=${snippetChars(low)} >= high=${snippetChars(high)} chars; the param looks ignored`);
	}
});

// --- Sonar -> Agent migration: canaries for the legacy Sonar backend and
// checks for the agent-backed `search` / `async_research`. ---
//
// A canary reports LOST when a Sonar feature stopped working (typically the
// sync request was reformulated onto the Agent API for that model). LOST does
// not fail the run: it is a signal that PERPLEXITY_SEARCH_BACKEND=sonar is no
// longer a faithful rollback for that feature.

let lost = 0;
async function canary(name, fn) {
	process.stdout.write(`  ${name.padEnd(52)} `);
	try {
		const problem = await fn();
		if (problem) {
			console.log(`LOST  ${problem}`);
			lost++;
		} else {
			console.log("OK");
		}
	} catch (err) {
		console.log(`LOST  request failed: ${String(err?.message ?? err).replace(/\s+/g, " ").slice(0, 140)}`);
		lost++;
	}
}

const hostsOf = (results) => new Set((results ?? []).map((r) => { try { return new URL(r.url).hostname; } catch { return ""; } }));
const sonarChat = (body) =>
	client.chat.completions.create({
		messages: [{ role: "user", content: body.content }],
		...Object.fromEntries(Object.entries(body).filter(([k]) => k !== "content")),
		stream: false,
	});

console.log("\nLegacy Sonar backend canaries (chat.completions; end of support 2026-09-27)");

for (const model of ["sonar", "sonar-pro", "sonar-reasoning-pro"]) {
	await canary(`${model}: sources + usage.cost`, async () => {
		const r = await sonarChat({ model, content: "What is the capital of Australia?", max_tokens: 64 });
		const missing = [];
		if (!(r.search_results ?? []).length) missing.push("search_results");
		if (r.usage?.cost?.total_cost === undefined) missing.push("usage.cost");
		return missing.length ? `missing ${missing.join(", ")}` : null;
	});
}

await canary("sonar-pro: return_images", async () => {
	const r = await sonarChat({ model: "sonar-pro", content: "Eiffel Tower photos", return_images: true, max_tokens: 64 });
	return (r.images ?? []).length ? null : "no images returned (the agent backend's image_search does return them)";
});

await canary("sonar-pro: return_related_questions", async () => {
	const r = await sonarChat({ model: "sonar-pro", content: "Eiffel Tower history", return_related_questions: true, max_tokens: 64 });
	return (r.related_questions ?? []).length ? null : "no related_questions returned";
});

await canary("sonar: search_mode academic changes sources", async () => {
	const content = "intermittent fasting insulin sensitivity";
	const web = await sonarChat({ model: "sonar", content, max_tokens: 32 });
	const acad = await sonarChat({ model: "sonar", content, search_mode: "academic", max_tokens: 32 });
	const a = hostsOf(web.search_results);
	const b = hostsOf(acad.search_results);
	const same = a.size === b.size && [...a].every((h) => b.has(h));
	return same ? "identical source hosts with and without academic mode" : null;
});

await check("async sonar model rejected (expected-reject)", async () => {
	try {
		await client.async.chat.completions.create({
			request: { model: "sonar", messages: [{ role: "user", content: "ok" }] },
		});
	} catch (err) {
		if (err?.status === 400) return true;
		throw new Error(`expected 400, got ${err?.status}: ${err?.message}`);
	}
	throw new Error("async accepted model 'sonar'; widen the legacy async model check in AsyncResearchHandler");
});

if (includeCostly) {
	await canary("legacy async deep-research submit", async () => {
		const job = await client.async.chat.completions.create({
			request: {
				model: "sonar-deep-research",
				reasoning_effort: "minimal",
				messages: [{ role: "user", content: "Reply with exactly: ok" }],
			},
		});
		return job?.id ? null : "no job id returned";
	});
} else {
	skipped("legacy async deep-research submit", "~$0.01 deep-research job; pass --include-costly to run");
}

console.log("\nAgent-backed search (bodies from build/services/agentSearchRequest.js)");

let buildAgentSearchRequest;
try {
	({ buildAgentSearchRequest } = await import("../build/services/agentSearchRequest.js"));
} catch {
	buildAgentSearchRequest = null;
}

if (buildAgentSearchRequest) {
	const agentSearch = (args, extra = {}) => {
		const { body } = buildAgentSearchRequest({ sonarModel: "sonar-pro", args, ...extra });
		return client.responses.create({ ...body, stream: false });
	};
	const itemsOf = (r, type) => (r?.output ?? []).filter((o) => o.type === type).flatMap((o) => o.results ?? []);

	await check("filters + user_location + context size", async () => {
		const r = await agentSearch(
			{ search_context_size: "low", country: "US" },
			{ query: "Latest Node.js LTS version?", domainFilters: ["nodejs.org"], recencyFilter: "year" }
		);
		const results = itemsOf(r, "search_results");
		if (!results.length) throw new Error("no search_results");
		const off = [...hostsOf(results)].filter((h) => !h.endsWith("nodejs.org"));
		if (off.length) throw new Error(`domain filter not applied: ${off.join(", ")}`);
		if (r.usage?.cost?.total_cost === undefined) throw new Error("usage.cost.total_cost missing (cost footer)");
	});

	await check("return_images -> image_search", async () => {
		const r = await agentSearch({ return_images: true, image_format_filter: ["jpg", "png"] }, { query: "Eiffel Tower photos" });
		if (!itemsOf(r, "image_search_results").length) throw new Error("no image_search_results");
	});

	await check("search_mode academic -> domain allowlist", async () => {
		const r = await agentSearch({ search_mode: "academic" }, { query: "intermittent fasting insulin sensitivity" });
		if (!itemsOf(r, "search_results").length) throw new Error("no search_results");
	});

	await check("search_mode sec -> finance_search + sec.gov", async () => {
		const r = await agentSearch({ search_mode: "sec" }, { query: "Apple total net sales fiscal 2025 10-K" });
		if (!r.output_text) throw new Error("no answer text");
	});

	await check("disable_search -> direct model, no search", async () => {
		const r = await agentSearch({ disable_search: true }, { query: "Reply with exactly: ok" });
		if (itemsOf(r, "search_results").length) throw new Error("search_results present; disable_search no longer suppresses search");
	});

	await check("search_type pro -> effort low", async () => {
		const r = await agentSearch({ search_type: "pro", max_tokens: 64 }, { query: "What is the capital of Australia?" });
		if (!String(r.effort ?? "").startsWith("low")) throw new Error(`ran effort ${r.effort}`);
	});
} else {
	skipped("agent-backed search checks", "run `npm run build` first (imports build/services/agentSearchRequest.js)");
}

console.log(`  (${lost} legacy Sonar feature(s) reported LOST; informational, not a failure)`);

console.log("\nAgent API (/v1/responses)");

const stored = await check("store + reasoning.effort max", () =>
	client.responses.create({
		input: "Reply with exactly: ok",
		effort: "fast",
		max_output_tokens: 16,
		reasoning: { effort: "max" },
		store: true,
		stream: false,
	})
);

if (stored?.id) {
	await check("previous_response_id", () =>
		client.responses.create({
			input: "Reply with exactly: ok",
			effort: "fast",
			max_output_tokens: 16,
			previous_response_id: stored.id,
			stream: false,
		})
	);
} else {
	skipped("previous_response_id", "no prior response id to chain from");
}

await check("temperature + top_p", () =>
	client.responses.create({
		input: "Reply with exactly: ok",
		effort: "fast",
		max_output_tokens: 16,
		temperature: 0.5,
		top_p: 0.9,
		stream: false,
	})
);

await check("prompt_cache_key", () =>
	client.responses.create({
		input: "Reply with exactly: ok",
		effort: "fast",
		max_output_tokens: 16,
		prompt_cache_key: "validate-params-probe",
		stream: false,
	})
);

await check("skills (builtin office)", () =>
	client.responses.create({
		input: "Reply with exactly: ok",
		effort: "fast",
		max_output_tokens: 16,
		skills: [{ type: "builtin", name: "office" }],
		stream: false,
	})
);

await check("skills (inline)", () =>
	client.responses.create({
		input: "Reply with exactly: ok",
		effort: "fast",
		max_output_tokens: 16,
		skills: [
			{
				type: "inline",
				name: "probe-skill",
				description: "A no-op probe skill.",
				instructions: "Do nothing special.",
			},
		],
		stream: false,
	})
);

// service_tier: "priority" bills at 2x token prices, so it is opt-in.
if (includeCostly) {
	await check("service_tier: priority (2x token price)", () =>
		client.responses.create({
			input: "Reply with exactly: ok",
			effort: "fast",
			max_output_tokens: 16,
			service_tier: "priority",
			stream: false,
		})
	);
} else {
	skipped("service_tier: priority", "costs 2x; pass --include-costly to run");
}

// mcp_servers needs a reachable Streamable-HTTP MCP endpoint. A discovery
// failure fails the whole run with a 424, so this is opt-in via env var.
const probeMcpUrl = process.env.PROBE_MCP_URL;
if (probeMcpUrl) {
	await check("mcp_servers", () =>
		client.responses.create({
			input: "List the tools you can access, then stop.",
			effort: "fast",
			max_output_tokens: 64,
			tools: [
				{
					type: "mcp",
					server_label: "probe",
					server_url: probeMcpUrl,
					...(process.env.PROBE_MCP_TOKEN
						? { authorization: process.env.PROBE_MCP_TOKEN }
						: {}),
				},
			],
			stream: false,
		})
	);
} else {
	skipped("mcp_servers", "set PROBE_MCP_URL to a Streamable-HTTP MCP endpoint");
}

// Multimodal input: wraps `input` into a single user message with an
// input_text part plus one input_image part per URL, mirrors what
// agentRespond() builds when `images` is set. Self-contained 1x1 PNG so this
// doesn't depend on an external image host being up.
const PIXEL_PNG_DATA_URI =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

await check("agent images (multimodal input)", () =>
	client.responses.create({
		input: [
			{
				type: "message",
				role: "user",
				content: [
					{ type: "input_text", text: "What color is this image? One word." },
					{ type: "input_image", image_url: PIXEL_PNG_DATA_URI },
				],
			},
		],
		effort: "fast",
		max_output_tokens: 16,
		stream: false,
	})
);

// --- Agent API wave-2 params (effort, tools options, files, approvals) ---

const OK = { input: "Reply with exactly: ok", effort: "fast", max_output_tokens: 16, stream: false };

async function expectReject(label, body, pattern) {
	try {
		await client.responses.create(body);
	} catch (err) {
		const msg = String(err?.message ?? err);
		if (pattern && !pattern.test(msg)) throw new Error(`rejected, but not as expected: ${msg.slice(0, 120)}`);
		return true;
	}
	throw new Error(`${label} was ACCEPTED - the API changed`);
}

await check("effort pinned (name@latest) echoes name@version", async () => {
	const r = await client.responses.create({ ...OK, effort: "low@latest" });
	if (!/^low@/.test(r.effort ?? "")) throw new Error(`unexpected effort echo: ${r.effort}`);
	return r;
});

await check("preset (deprecated alias) still accepted", () =>
	client.responses.create({ ...OK, effort: undefined, preset: "fast" })
);

await check("unknown effort is rejected (expected-reject)", () =>
	expectReject("effort 'bogus-level'", { ...OK, effort: "bogus-level" }, /effort/i)
);

await check("profile + effort is rejected (expected-reject)", () =>
	expectReject("profile + effort", { ...OK, profile: { type: "custom", id: "profile_probe" } }, /profile/i)
);

await check("reasoning.effort none", () => client.responses.create({ ...OK, reasoning: { effort: "none" } }));

await check("max_steps 500 accepted", () => client.responses.create({ ...OK, max_steps: 500 }));

await check("max_steps 501 is rejected (expected-reject)", () =>
	expectReject("max_steps 501", { ...OK, max_steps: 501 }, /max steps|max_steps/i)
);

await check("tool_choice + service_tier flex", async () => {
	const r = await client.responses.create({ ...OK, tool_choice: "auto", service_tier: "flex" });
	if (r.service_tier !== "flex") throw new Error(`service_tier echo was ${r.service_tier}`);
	return r;
});

// Mirrors buildWebSearchTool(): flat options, filters nested under `filters`.
await check("web_search tool options + filters", () =>
	client.responses.create({
		...OK,
		input: "Latest Node.js LTS version? One line.",
		max_output_tokens: 64,
		tools: [
			{
				type: "web_search",
				search_type: "web",
				max_results: 3,
				max_tokens: 2000,
				max_tokens_per_page: 500,
				user_location: { country: "US" },
				filters: { search_domain_filter: ["nodejs.org"], search_recency_filter: "year" },
			},
		],
	})
);

await check("web_search date filters (published + last_updated)", () =>
	client.responses.create({
		...OK,
		input: "Latest Node.js release? One line.",
		max_output_tokens: 64,
		tools: [
			{
				type: "web_search",
				search_type: "fast",
				filters: { search_after_date_filter: "1/1/2025", last_updated_after_filter: "1/1/2025" },
			},
		],
	})
);

// The API forbids recency together with published-date filters; validation.ts
// mirrors this. Fails here if the API ever relaxes the rule.
await check("web_search recency + date filter is rejected (expected-reject)", () =>
	expectReject(
		"recency + search_after_date_filter",
		{ ...OK, tools: [{ type: "web_search", filters: { search_recency_filter: "year", search_after_date_filter: "1/1/2025" } }] },
		/search_recency_filter/
	)
);

await check("image_search tool returns image_search_results", async () => {
	const r = await client.responses.create({
		...OK,
		input: "Find one image of the Eiffel Tower, then reply 'done'.",
		max_output_tokens: 64,
		tools: [{ type: "image_search" }],
		tool_choice: "required",
	});
	if (!(r.output ?? []).some((o) => o.type === "image_search_results")) throw new Error("no image_search_results item");
	return r;
});

await check("agent files (input_file, inline file_data)", async () => {
	const r = await client.responses.create({
		...OK,
		input: [
			{
				type: "message",
				role: "user",
				content: [
					{ type: "input_text", text: "What single word is in the file? Reply with it only." },
					{ type: "input_file", file_data: Buffer.from("pineapple").toString("base64"), filename: "probe.txt" },
				],
			},
		],
	});
	if (!/pineapple/i.test(r.output_text ?? "")) throw new Error(`file content not read: ${r.output_text}`);
	return r;
});

// MCP approval round-trip against the public DeepWiki server the Perplexity
// docs use (override with PROBE_APPROVAL_MCP_URL; set it to "skip" to skip).
const approvalMcpUrl = process.env.PROBE_APPROVAL_MCP_URL ?? "https://mcp.deepwiki.com/mcp";
if (approvalMcpUrl !== "skip") {
	const approvalTools = [
		{ type: "mcp", server_label: "deepwiki", server_url: approvalMcpUrl, require_approval: "always", allowed_tools: ["read_wiki_structure"] },
	];
	const gated = await check("mcp require_approval returns mcp_approval_request", async () => {
		const r = await client.responses.create({
			model: "openai/gpt-6-luna",
			input: "Use the read_wiki_structure tool on repo perplexityai/perplexity-py, then reply in one line.",
			max_steps: 3,
			max_output_tokens: 200,
			tools: approvalTools,
			stream: false,
		});
		const reqs = (r.output ?? []).filter((o) => o.type === "mcp_approval_request");
		if (reqs.length === 0) throw new Error("model did not request an approval-gated call");
		return { id: r.id, reqs };
	});
	if (gated?.reqs?.length) {
		await check("approval_responses continuation runs the call", async () => {
			const r = await client.responses.create({
				model: "openai/gpt-6-luna",
				previous_response_id: gated.id,
				max_steps: 3,
				max_output_tokens: 200,
				tools: approvalTools,
				input: gated.reqs.map((q) => ({ type: "mcp_approval_response", approval_request_id: q.id, approve: true })),
				stream: false,
			});
			if (!(r.output ?? []).some((o) => o.type === "mcp_call")) throw new Error("approved call did not run");
			return r;
		});
	} else {
		skipped("approval_responses continuation", "no approval request to answer");
	}
} else {
	skipped("mcp require_approval round-trip", "PROBE_APPROVAL_MCP_URL=skip");
}

await check("models.list (typed resource)", async () => {
	const r = await client.models.list();
	if (!Array.isArray(r.data) || r.data.length === 0) throw new Error("empty model catalog");
	return r;
});

console.log("\nAgent cancel + files (client.responses.cancel / .files.*)");

const cancelTarget = await check("submit background run to cancel", () =>
	client.responses.create({
		input: "Count slowly from 1 to 100, one number per line.",
		effort: "fast",
		max_output_tokens: 2000,
		background: true,
		stream: false,
	})
);

if (cancelTarget?.id) {
	await check("responses.cancel", () => client.responses.cancel(cancelTarget.id));
} else {
	skipped("responses.cancel", "no background run id to cancel");
}

if (includeCostly) {
	const sandboxRun = await check("submit sandbox run that writes a file", () =>
		client.responses.create({
			input:
				"Use the sandbox to write the text 'validate-params probe' to a file named probe.txt, then confirm it was written.",
			effort: "fast",
			max_output_tokens: 512,
			tools: [{ type: "sandbox" }],
			stream: false,
		})
	);

	if (sandboxRun?.id) {
		const fileList = await check("responses.files.list", () =>
			client.responses.files.list(sandboxRun.id)
		);
		const firstFile = fileList?.data?.[0];
		if (firstFile?.id) {
			await check("responses.files.content", async () => {
				const resp = await client.responses.files.content(firstFile.id, {
					response_id: sandboxRun.id,
				});
				const bytes = Buffer.from(await resp.arrayBuffer());
				if (bytes.byteLength === 0) throw new Error("downloaded 0 bytes");
				return bytes.byteLength;
			});
		} else {
			skipped("responses.files.content", "sandbox run produced no files to fetch");
		}
	} else {
		skipped("responses.files.list / .content", "sandbox run did not return a response id");
	}
} else {
	skipped("agent_files (sandbox file round-trip)", "spends agent+sandbox tokens; pass --include-costly to run");
}

console.log("\nEmbeddings API");

await check("encoding_format: base64_int8", () =>
	client.embeddings.create({
		input: "probe",
		model: "pplx-embed-v1-0.6b",
		encoding_format: "base64_int8",
	})
);

await check("encoding_format: base64_binary", () =>
	client.embeddings.create({
		input: "probe",
		model: "pplx-embed-v1-0.6b",
		encoding_format: "base64_binary",
	})
);

console.log("\nContextualized Embeddings API");

await check("contextualizedEmbeddings.create", () =>
	client.contextualizedEmbeddings.create({
		input: [["First chunk of document one.", "Second chunk of document one."]],
		model: "pplx-embed-context-v1-0.6b",
	})
);

// The tool schema documents "omitted = base64_int8"; the API reference says
// so too. Fails if the default ever changes (verified identical 2026-11-12).
await check("encoding_format default is base64_int8", async () => {
	const [def, int8] = await Promise.all([
		client.embeddings.create({ input: "probe", model: "pplx-embed-v1-0.6b" }),
		client.embeddings.create({ input: "probe", model: "pplx-embed-v1-0.6b", encoding_format: "base64_int8" }),
	]);
	if (def.data?.[0]?.embedding !== int8.data?.[0]?.embedding) {
		throw new Error("omitted encoding_format no longer matches base64_int8");
	}
	if (def.usage?.cost?.total_cost === undefined) throw new Error("usage.cost.total_cost missing");
});

console.log("\nDecisions API");

const decisionQuestions = {
	defect: { type: "noul", instructions: "Does the text report a product defect?" },
	tone: { type: "choice", criteria: { positive: null, mixed: null, negative: null } },
	severity: { type: "score", criteria: ["Cosmetic", "Inconvenient", "Unusable"] },
};

await check("decisions.create (noul + choice + score)", async () => {
	const r = await client.decisions.create({
		model: "pplx-decider-flash-latest",
		state: "The battery stopped charging after two weeks.",
		questions: decisionQuestions,
	});
	for (const [name, q] of Object.entries(decisionQuestions)) {
		if (r.answers?.[name]?.type !== q.type) throw new Error(`missing/mistyped answer for ${name}`);
	}
});

// mode and max_staleness are absent from the SDK's DecisionsRequestInput; the
// API 400s on unknown fields, so a PASS proves both are real (~$0.002).
await check("decisions mode:web_grounding + max_staleness", async () => {
	const r = await client.decisions.create({
		model: "pplx-decider-flash-latest",
		mode: "web_grounding",
		max_staleness: 86400,
		state: "https://nodejs.org/en/about/previous-releases",
		questions: { lts: { type: "noul", instructions: "Does this page list Node.js 24 as LTS?" } },
	});
	if (!Array.isArray(r.search_results)) throw new Error("search_results missing under web_grounding");
});

await check("decisions rejects unknown question type (expected-reject)", async () => {
	try {
		await client.decisions.create({
			model: "pplx-decider-flash-latest",
			state: "x",
			questions: { a: { type: "binary", instructions: "y?" } },
		});
	} catch (err) {
		if (err?.status === 400) return;
		throw err;
	}
	throw new Error("API now accepts type 'binary'; update the decisions tool enum");
});

console.log("\nSkills API");

await check("skills.list", async () => {
	const r = await client.skills.list({ limit: 5 });
	if (!Array.isArray(r.skills)) throw new Error("skills array missing");
	if (r.skills[0]) await client.skills.retrieve(r.skills[0].skill_id);
});

console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped\n`);
process.exit(fail > 0 ? 1 : 0);
