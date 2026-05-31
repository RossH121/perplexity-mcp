/**
 * Handler for async_research tool — submit / poll / list async deep-research jobs.
 * Async Sonar jobs have a 7-day TTL.
 */

import { McpRequest, AsyncResearchArgs, SearchArgs } from "../schemas/types.js";
import { isValidAsyncResearchArgs } from "../schemas/validation.js";
import { PerplexityApiService } from "../services/PerplexityApiService.js";
import { ErrorHandler } from "../utils/errorHandling.js";
import { stripThinkingBlocks, renderSearchResults } from "../utils/responseFormatting.js";
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";

export class AsyncResearchHandler {
	constructor(private apiService: PerplexityApiService) {}

	async handle(request: McpRequest) {
		if (!isValidAsyncResearchArgs(request.params.arguments)) {
			throw ErrorHandler.createMcpError(
				ErrorCode.InvalidParams,
				"Invalid async_research arguments. 'action' must be submit|status|list; submit requires 'query', status requires 'request_id'."
			);
		}

		const args = request.params.arguments as AsyncResearchArgs;

		try {
			switch (args.action) {
				case "submit":
					return this.submit(args);
				case "status":
					return this.status(args);
				case "list":
					return this.list();
			}
		} catch (error) {
			return ErrorHandler.handleApiError(error);
		}
	}

	private async submit(args: AsyncResearchArgs) {
		const apiParams = this.apiService.createApiParams({
			model: args.model ?? "sonar-deep-research",
			query: args.query as string,
			args: {
				query: args.query,
				reasoning_effort: args.reasoning_effort,
				search_mode: args.search_mode,
			} as SearchArgs,
			systemPrompt: "You are a helpful assistant that performs thorough web research.",
		});

		const job = await this.apiService.submitAsyncResearch(apiParams);
		const lines = [
			"## Async research job submitted",
			`Request ID: ${job.id}`,
			`Status: ${job.status}`,
			"",
			`Poll with: async_research { action: "status", request_id: "${job.id}" }`,
			"Jobs expire 7 days after creation.",
		];
		return { content: [{ type: "text", text: lines.join("\n") }] };
	}

	private async status(args: AsyncResearchArgs) {
		const job = await this.apiService.getAsyncResearch(args.request_id as string);
		const header = `## Job ${job.id}\nStatus: ${job.status}`;

		if (job.status === "FAILED") {
			let text = `${header}\n\nThis job failed and will not produce a result.`;
			text += `\nError: ${job.error_message ?? "(no error message provided)"}`;
			if (job.failed_at) text += `\nFailed at: ${job.failed_at}`;
			return { content: [{ type: "text", text }] };
		}

		if (job.status !== "COMPLETED" || !job.response) {
			const extra = job.error_message ? `\nError: ${job.error_message}` : "";
			return { content: [{ type: "text", text: `${header}${extra}\n\n(Not ready yet — poll again.)` }] };
		}

		const resp = job.response;
		let content = resp?.choices?.[0]?.message?.content ?? "";
		if (args.strip_thinking) content = stripThinkingBlocks(content);

		let text = `${header}\n\n${content}`;
		text += renderSearchResults(resp?.search_results);
		return { content: [{ type: "text", text }] };
	}

	private async list() {
		const result = await this.apiService.listAsyncResearch();
		const jobs = result?.requests ?? result?.data ?? [];
		if (!Array.isArray(jobs) || jobs.length === 0) {
			return { content: [{ type: "text", text: "No async research jobs found." }] };
		}
		const lines = ["## Async research jobs", ""];
		jobs.forEach((j: any) => {
			lines.push(`- ${j.id} — ${j.status}${j.model ? ` (${j.model})` : ""}`);
		});
		return { content: [{ type: "text", text: lines.join("\n") }] };
	}
}
