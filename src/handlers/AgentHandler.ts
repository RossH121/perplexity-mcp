/**
 * Handler for the agent tool — Perplexity Agent API via the responses surface.
 * Supports third-party models, presets, and built-in tools (web_search, fetch_url).
 */

import { McpRequest, AgentArgs } from "../schemas/types.js";
import { isValidAgentArgs } from "../schemas/validation.js";
import { PerplexityApiService } from "../services/PerplexityApiService.js";
import { ErrorHandler } from "../utils/errorHandling.js";
import { renderSearchResults } from "../utils/responseFormatting.js";
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";

export class AgentHandler {
	constructor(private apiService: PerplexityApiService) {}

	async handle(request: McpRequest) {
		if (!isValidAgentArgs(request.params.arguments)) {
			throw ErrorHandler.createMcpError(
				ErrorCode.InvalidParams,
				"Invalid agent arguments. 'input' must be a non-empty string."
			);
		}

		const args = request.params.arguments as AgentArgs;

		try {
			const resp = await this.apiService.agentRespond(args);

			const modelLabel = resp?.model ? `[Agent model: ${resp.model}]\n\n` : "";

			// Prefer the SDK convenience field; fall back to aggregating message output items.
			let text: string = resp?.output_text ?? "";
			if (!text && Array.isArray(resp?.output)) {
				text = resp.output
					.filter((o: any) => o.type === "message")
					.flatMap((o: any) => (o.content ?? []))
					.map((c: any) => c.text ?? "")
					.join("");
			}

			// Collect web_search results and fetch_url results from output items.
			let searchResults: any[] = [];
			const fetchedUrls: Array<{ title?: string; url?: string; snippet?: string }> = [];
			if (Array.isArray(resp?.output)) {
				for (const item of resp.output) {
					if (item?.type === "search_results" && Array.isArray(item.results)) {
						searchResults = searchResults.concat(item.results);
					}
					if (item?.type === "fetch_url_results" && Array.isArray(item.contents)) {
						for (const c of item.contents) {
							if (c && (c.url || c.title)) {
								fetchedUrls.push({ title: c.title, url: c.url, snippet: c.snippet });
							}
						}
					}
				}
			}

			let responseText = modelLabel + (text || "(no text output)");
			responseText += renderSearchResults(searchResults);

			if (fetchedUrls.length > 0) {
				const fetchedLines = ["", "## Fetched URLs"];
				fetchedUrls.forEach((f, i) => {
					const title = f.title?.trim() || f.url || `Result ${i + 1}`;
					fetchedLines.push(f.url ? `${i + 1}. [${title}](${f.url})` : `${i + 1}. ${title}`);
					if (f.snippet?.trim()) fetchedLines.push(`   ${f.snippet.trim()}`);
				});
				responseText += "\n" + fetchedLines.join("\n");
			}

			return { content: [{ type: "text", text: responseText }] };
		} catch (error) {
			return ErrorHandler.handleApiError(error);
		}
	}
}
