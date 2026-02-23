/**
 * Handler for raw_search tool — returns ranked results without LLM synthesis
 */

import { McpRequest, RawSearchArgs } from "../schemas/types.js";
import { isValidRawSearchArgs } from "../schemas/validation.js";
import { PerplexityApiService } from "../services/PerplexityApiService.js";
import { ErrorHandler } from "../utils/errorHandling.js";
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";

export class RawSearchHandler {
	constructor(private apiService: PerplexityApiService) {}

	async handle(request: McpRequest) {
		if (!isValidRawSearchArgs(request.params.arguments)) {
			throw ErrorHandler.createMcpError(
				ErrorCode.InvalidParams,
				"Invalid raw_search arguments. Query must be a non-empty string. max_results must be 1-20."
			);
		}

		const args = request.params.arguments as RawSearchArgs;

		try {
			const results = await this.apiService.rawSearch(args);

			if (results.length === 0) {
				return {
					content: [{ type: "text", text: "No results found." }],
				};
			}

			const lines: string[] = [`## Search Results for: "${args.query}"\n`];

			results.forEach((result, index) => {
				lines.push(`### [${index + 1}] ${result.title}`);
				lines.push(`URL: ${result.url}`);
				if (result.date) lines.push(`Date: ${result.date}`);
				if (result.last_updated) lines.push(`Last updated: ${result.last_updated}`);
				if (result.snippet) lines.push(`\n${result.snippet}`);
				lines.push("");
			});

			return {
				content: [{ type: "text", text: lines.join("\n") }],
			};
		} catch (error) {
			return ErrorHandler.handleApiError(error);
		}
	}
}
