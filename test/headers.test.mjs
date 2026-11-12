/**
 * X-Pplx-Integration attribution header: sent as perplexity-mcp/<version> to
 * the public API host only, never to a custom PERPLEXITY_BASE_URL.
 */
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { PerplexityApiService } from "../build/services/PerplexityApiService.js";
import { TEST_CONFIG } from "./helpers.mjs";

const { version } = createRequire(import.meta.url)("../package.json");
const realFetch = globalThis.fetch;
const realBaseUrl = process.env.PERPLEXITY_BASE_URL;

afterEach(() => {
	globalThis.fetch = realFetch;
	if (realBaseUrl === undefined) delete process.env.PERPLEXITY_BASE_URL;
	else process.env.PERPLEXITY_BASE_URL = realBaseUrl;
});

/** Builds a service against a stubbed fetch and returns the outbound request. */
async function captureRequest(baseUrl) {
	if (baseUrl === undefined) delete process.env.PERPLEXITY_BASE_URL;
	else process.env.PERPLEXITY_BASE_URL = baseUrl;

	let captured;
	globalThis.fetch = async (url, init) => {
		captured = { url: String(url), headers: new Headers(init.headers) };
		return new Response(JSON.stringify({ results: [] }), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	};
	const service = new PerplexityApiService(TEST_CONFIG);
	await service.rawSearch({ query: "test" });
	assert.ok(captured, "fetch was not called");
	return captured;
}

test("default host sends perplexity-mcp/<version>", async () => {
	const req = await captureRequest(undefined);
	assert.match(req.url, /^https:\/\/api\.perplexity\.ai\//);
	assert.equal(req.headers.get("x-pplx-integration"), `perplexity-mcp/${version}`);
});

test("explicit public base URL sends the header", async () => {
	const req = await captureRequest("https://api.perplexity.ai/");
	assert.equal(req.headers.get("x-pplx-integration"), `perplexity-mcp/${version}`);
});

for (const baseUrl of ["https://proxy.example.com", "https://api.perplexity.ai.evil.com"]) {
	test(`custom host ${baseUrl} does not get the mcp header`, async () => {
		const req = await captureRequest(baseUrl);
		assert.ok(req.url.startsWith(baseUrl), `request went to ${req.url}`);
		assert.notEqual(req.headers.get("x-pplx-integration"), `perplexity-mcp/${version}`);
	});
}
