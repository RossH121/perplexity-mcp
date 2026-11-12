/**
 * Test helpers: an in-process MCP Client wired to a PerplexityMcpServer whose
 * PerplexityApiService network methods are replaced by fakes.
 *
 * Tests import from build/ (run `npm test`, which builds first).
 */

// SDK v2: Client + InMemoryTransport from the client package. Both halves of
// a linked pair come from one createLinkedPair call (v2 requires the pair to
// share a package). createLinkedPair is 2025-era only; 2026-07-28 coverage is
// the spawned-stdio test in test/stdio.test.mjs.
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";

import { PerplexityMcpServer } from "../build/server/PerplexityMcpServer.js";
import { PerplexityApiService } from "../build/services/PerplexityApiService.js";

export const TEST_CONFIG = { apiKey: "test-key-not-used", defaultModel: "sonar-pro" };

/** Realistic response shapes for every network method on PerplexityApiService. */
export function defaultFakes() {
	return {
		search: async () => ({
			choices: [{ message: { content: "Synthesized answer." } }],
			search_results: [{ title: "Example", url: "https://example.com" }],
			usage: { total_tokens: 10, cost: { total_cost: 0.001 } },
		}),
		searchStream: async () => ({ content: "Streamed answer." }),
		rawSearch: async () => [
			{ title: "Result one", url: "https://example.com/1", snippet: "Snippet one", date: "2026-01-01" },
		],
		submitAsyncResearch: async () => ({ id: "req_1", status: "CREATED" }),
		getAsyncResearch: async (id) => ({
			id,
			status: "COMPLETED",
			response: {
				choices: [{ message: { content: "<think>hidden</think>Research report." } }],
				search_results: [{ title: "Source", url: "https://example.com/s" }],
			},
		}),
		listAsyncResearch: async () => ({ requests: [{ id: "req_1", status: "COMPLETED", model: "sonar-deep-research" }] }),
		// Agent-backed search / async_research submit (prebuilt Agent API body).
		agentSearch: async (body) =>
			body?.background
				? { id: "resp_bg_1", status: "queued", effort: "high@2026-11-11.0" }
				: {
						id: "resp_s1",
						model: "openai/gpt-6-luna",
						effort: "fast@2026-11-11.0",
						status: "completed",
						output: [
							{ type: "search_results", results: [{ id: 1, title: "Example", url: "https://example.com", snippet: "s" }] },
							{ type: "message", content: [{ type: "output_text", text: "Synthesized answer.[1]" }] },
						],
						output_text: "Synthesized answer.[1]",
						usage: { input_tokens: 5, output_tokens: 5, total_tokens: 10, cost: { total_cost: 0.0015 } },
				  },
		agentRespond: async () => ({
			id: "resp_1",
			model: "openai/gpt-5",
			status: "completed",
			output_text: "Agent answer.",
		}),
		getAgentResponse: async (id) => ({ id, status: "completed", output_text: "Retrieved answer." }),
		cancelAgentResponse: async (id) => ({ response_id: id, status: "cancelling" }),
		listAgentFiles: async () => ({ data: [{ id: "file_1", filename: "report.pdf", bytes: 3 }] }),
		getAgentFileContent: async () => ({
			buffer: Buffer.from("abc"),
			contentType: "application/pdf",
			filename: "report.pdf",
		}),
		listModels: async () => ({
			data: [
				{ id: "sonar", owned_by: "perplexity" },
				{ id: "openai/gpt-5.1", owned_by: "openai" },
				{ id: "anthropic/claude-sonnet-4-6", owned_by: "anthropic" },
			],
		}),
		createEmbeddings: async () => ({
			model: "pplx-embed-v1-0.6b",
			data: [{ embedding: "AAAA" }],
			usage: { total_tokens: 3 },
		}),
		createContextualizedEmbeddings: async () => ({
			model: "pplx-embed-context-v1-0.6b",
			data: [{ data: [{ embedding: "AAAA" }, { embedding: "BBBB" }] }],
			usage: { total_tokens: 6 },
		}),
		// Shape observed live 2026-11-12 (no cost field; output tokens free).
		createDecision: async () => ({
			model: "pplx-decider-latest",
			answers: { defect: { type: "noul", noul: 0.9384451966218283 } },
			usage: { input_tokens: 160, output_tokens: 1 },
		}),
		listSkills: async () => ({
			skills: [{ skill_id: "skill_abc123", name: "house-style", revision: "rev_2", updated_at: "2026-11-01T00:00:00Z" }],
		}),
		getSkill: async (id) => ({
			skill_id: id,
			name: "house-style",
			description: "Apply the house style guide.",
			revision: "rev_2",
			latest_revision: "rev_2",
		}),
	};
}

/**
 * Start a server + client pair. `fakes` overrides individual service methods.
 * Every fake call is recorded in `calls` as { method, args } so tests can
 * assert on what reached the service, including the trailing HandlerContext.
 *
 * `era`:
 * - undefined (default): server.connect() on one half of an in-memory pair,
 *   2025-era initialize handshake (what every pre-v2 test was written for).
 * - "legacy" | "modern": the production entry, serveStdio, over an in-memory
 *   transport; the client negotiates 2025-11-25 ("legacy") or pins
 *   2026-07-28 ("modern", server/discover + per-request _meta envelope).
 */
export async function startServer(fakes = {}, { era, clientOptions = {} } = {}) {
	const apiService = new PerplexityApiService(TEST_CONFIG);
	const calls = [];
	for (const [method, impl] of Object.entries({ ...defaultFakes(), ...fakes })) {
		apiService[method] = async (...args) => {
			calls.push({ method, args });
			return impl(...args);
		};
	}

	const server = new PerplexityMcpServer({ config: TEST_CONFIG, apiService });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	if (era) server.serve(serverTransport);
	else await server.connect(serverTransport);

	const client = new Client(
		{ name: "test-client", version: "0.0.0" },
		{
			...(era === "modern" ? { versionNegotiation: { mode: { pin: "2026-07-28" } } } : {}),
			...clientOptions,
		}
	);
	await client.connect(clientTransport);

	return {
		client,
		calls,
		async close() {
			await client.close();
			await server.close();
		},
	};
}

export function textOf(result) {
	return result.content
		.filter((c) => c.type === "text")
		.map((c) => c.text)
		.join("\n");
}

/** An Error shaped like a Perplexity SDK APIError. */
export function apiError(status, message) {
	const err = new Error(`${status} ${message}`);
	err.status = status;
	err.body = { error: { message } };
	return err;
}
