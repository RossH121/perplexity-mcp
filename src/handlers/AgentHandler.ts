/**
 * Handler for the agent tool — Perplexity Agent API via the responses surface.
 * Supports third-party models, presets, built-in tools (web_search, fetch_url,
 * people_search, finance_search, sandbox), structured output, nested reasoning
 * effort, and background (queued) execution.
 */

import { McpRequest, AgentArgs } from "../schemas/types.js";
import { isValidAgentArgs } from "../schemas/validation.js";
import { PerplexityApiService } from "../services/PerplexityApiService.js";
import { ErrorHandler } from "../utils/errorHandling.js";
import { renderSearchResults } from "../utils/responseFormatting.js";
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";

// Terminal vs. still-running statuses on the responses surface.
const PENDING_STATUSES = new Set(["queued", "in_progress", "requires_action"]);

/**
 * Renders an Agent API response object into display text. Shared by the `agent`
 * and `agent_retrieve` tools so submit and poll render identically. For a
 * still-running background job, returns an id + status block instead of output.
 */
export function renderAgentResponse(resp: any): string {
	const modelLabel = resp?.model ? `[Agent model: ${resp.model}]\n\n` : "";
	const status: string | undefined = resp?.status;

	// Prefer the SDK convenience field; fall back to aggregating message output items.
	let text: string = resp?.output_text ?? "";
	if (!text && Array.isArray(resp?.output)) {
		text = resp.output
			.filter((o: any) => o.type === "message")
			.flatMap((o: any) => (o.content ?? []))
			.map((c: any) => c.text ?? "")
			.join("");
	}

	// A queued/in-progress background job has no output yet — surface id + status.
	if (!text && status && PENDING_STATUSES.has(status)) {
		const id = resp?.id ? `\nResponse id: ${resp.id}` : "";
		return `${modelLabel}Agent run status: ${status}.${id}\n\nPoll with agent_retrieve using this response id.`;
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

	const statusLabel =
		status && status !== "completed" ? `[status: ${status}]\n\n` : "";
	let responseText = modelLabel + statusLabel + (text || "(no text output)");
	if (resp?.id) responseText += `\n\n[response id: ${resp.id}]`;
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

	return responseText;
}

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
			return { content: [{ type: "text", text: renderAgentResponse(resp) }] };
		} catch (error) {
			return ErrorHandler.handleApiError(error);
		}
	}
}
