/**
 * Handler for raw_search tool — returns ranked results without LLM synthesis
 */

import { McpRequest, HandlerContext, RawSearchArgs } from "../schemas/types.js";
import { isValidRawSearchArgs } from "../schemas/validation.js";
import { PerplexityApiService } from "../services/PerplexityApiService.js";
import { ErrorHandler } from "../utils/errorHandling.js";
import { structuredResult, toSources } from "../utils/structuredResult.js";

export class RawSearchHandler {
	constructor(private apiService: PerplexityApiService) {}

	async handle(request: McpRequest, ctx: HandlerContext = {}) {
		if (!isValidRawSearchArgs(request.params.arguments)) {
			throw ErrorHandler.validationError(
				"Invalid raw_search arguments. Query must be a non-empty string or an array of 1-5 non-empty strings. max_results must be 1-20 (1-50 with search_type 'people'). search_type must be web, fast or people."
			);
		}

		const args = request.params.arguments as RawSearchArgs;

		try {
			const results = await this.apiService.rawSearch(args, ctx);
			const sources = toSources(results);
			const data = {
				queries: Array.isArray(args.query) ? args.query : [args.query],
				count: sources.length,
				results: sources,
			};

			if (results.length === 0) {
				return structuredResult("No results found.", data);
			}

			const queryLabel = Array.isArray(args.query) ? args.query.join('", "') : args.query;
			const lines: string[] = [`## Search Results for: "${queryLabel}"\n`];

			results.forEach((result, index) => {
				lines.push(`### [${index + 1}] ${result.title}`);
				lines.push(`URL: ${result.url}`);
				if (result.date) lines.push(`Date: ${result.date}`);
				if (result.last_updated) lines.push(`Last updated: ${result.last_updated}`);
				if (result.snippet) lines.push(`\n${result.snippet}`);
				lines.push("");
			});

			return structuredResult(lines.join("\n"), data);
		} catch (error) {
			return ErrorHandler.handleApiError(error);
		}
	}
}
