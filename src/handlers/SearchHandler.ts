/**
 * Handler for search tool functionality
 */

import { McpRequest, SearchArgs } from "../schemas/types.js";
import { isValidSearchArgs } from "../schemas/validation.js";
import { PerplexityApiService } from "../services/PerplexityApiService.js";
import { ModelSelectionService } from "../services/ModelSelectionService.js";
import { FilterState } from "../models/FilterState.js";
import { ErrorHandler } from "../utils/errorHandling.js";
import {
	stripThinkingBlocks,
	normalizeMessageContent,
	renderResponseExtras,
} from "../utils/responseFormatting.js";
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";

export class SearchHandler {
	constructor(
		private apiService: PerplexityApiService,
		private modelSelectionService: ModelSelectionService,
		private filterState: FilterState,
		private currentModel: string,
		private useAutoSelection: boolean
	) {}

	async handle(request: McpRequest) {
		if (!isValidSearchArgs(request.params.arguments)) {
			throw ErrorHandler.createMcpError(
				ErrorCode.InvalidParams,
				"Invalid search arguments. Query must be a non-empty string."
			);
		}

		const args = request.params.arguments as SearchArgs;
		const { query, stream = false, strip_thinking, show_cost } = args;

		try {
			// Get model selection based on intent
			const selection = this.modelSelectionService.selectModelBasedOnIntent(query);
			let description: string;
			let selectedModel: string;

			// Determine which model to use
			if (this.useAutoSelection) {
				selectedModel = selection.model;
				description = selection.description;
			} else {
				if (selection.score >= 2 && selection.model !== this.currentModel) {
					selectedModel = selection.model;
					description = `${selection.description} (auto-selected based on query intent)`;
				} else {
					selectedModel = this.currentModel;
					description = this.modelSelectionService.getModelDescription(this.currentModel);
				}
			}

			// Get domain filters and recency filter
			const domainFilterArray = this.filterState.getDomainFilterArray();
			const recencyFilter = this.filterState.getRecencyFilter();

			// Create API parameters (includes all new params)
			const apiParams = this.apiService.createApiParams({
				model: selectedModel,
				query,
				domainFilters: domainFilterArray.length > 0 ? domainFilterArray : undefined,
				recencyFilter: recencyFilter || undefined,
				args,
			});

			const modelInfo = `[Using model: ${selectedModel} - ${description}]\n\n`;

			if (stream) {
				const streamResult = await this.apiService.searchStream(apiParams);
				let content = streamResult.content;

				if (strip_thinking) {
					content = stripThinkingBlocks(content);
				}

				let responseText = modelInfo + content;
				responseText += renderResponseExtras(streamResult, !!show_cost);

				return {
					content: [{ type: "text", text: responseText }],
				};
			} else {
				const response = await this.apiService.search(apiParams);

				if (response.choices && response.choices.length > 0) {
					let content = normalizeMessageContent(response.choices[0].message.content);

					if (strip_thinking) {
						content = stripThinkingBlocks(content);
					}

					let responseText = modelInfo + content;
					responseText += renderResponseExtras(response, !!show_cost);

					return {
						content: [{ type: "text", text: responseText }],
					};
				}
				throw new Error("No response content received");
			}
		} catch (error) {
			if (error instanceof Error && error.message === "No response content received") {
				throw error;
			}
			return stream
				? ErrorHandler.handleStreamingApiError(error)
				: ErrorHandler.handleApiError(error);
		}
	}
}
