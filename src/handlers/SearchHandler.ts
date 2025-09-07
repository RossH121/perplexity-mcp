/**
 * Handler for search tool functionality
 */

import { McpRequest, SearchArgs } from "../schemas/types.js";
import { isValidSearchArgs } from "../schemas/validation.js";
import { PerplexityApiService } from "../services/PerplexityApiService.js";
import { ModelSelectionService } from "../services/ModelSelectionService.js";
import { FilterState } from "../models/FilterState.js";
import { ErrorHandler } from "../utils/errorHandling.js";
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

		const { query, stream = false } = request.params.arguments as SearchArgs;
		
		try {

			// Get model selection based on intent
			const selection = this.modelSelectionService.selectModelBasedOnIntent(query);
			let description: string;
			let selectedModel: string;

			// Determine which model to use
			if (this.useAutoSelection) {
				// Auto-select model based on intent
				selectedModel = selection.model;
				description = selection.description;
			} else {
				// We're using a manually set model
				// But check if we have a strong match that should override
				if (selection.score >= 2 && selection.model !== this.currentModel) {
					// Strong intent match - override manual selection
					selectedModel = selection.model;
					description = `${selection.description} (auto-selected based on query intent)`;
				} else {
					// Stick with manually selected model
					selectedModel = this.currentModel;
					description = this.modelSelectionService.getModelDescription(this.currentModel);
				}
			}

			// Get domain filters and recency filter
			const domainFilterArray = this.filterState.getDomainFilterArray();
			const recencyFilter = this.filterState.getRecencyFilter();

			// Create API parameters
			const apiParams = this.apiService.createApiParams(
				selectedModel,
				query,
				domainFilterArray.length > 0 ? domainFilterArray : undefined,
				recencyFilter || undefined,
				stream
			);

			// Include model information at the start of responses
			const modelInfo = `[Using model: ${selectedModel} - ${description}]\n\n`;

			if (stream) {
				// Handle streaming response
				const streamedContent = await this.apiService.searchStream(apiParams);
				return {
					content: [
						{
							type: "text",
							text: modelInfo + streamedContent,
						},
					],
				};
			} else {
				// Handle regular response
				const response = await this.apiService.search(apiParams);

				if (response.choices && response.choices.length > 0) {
					return {
						content: [
							{
								type: "text",
								text: modelInfo + response.choices[0].message.content,
							},
						],
					};
				}
				throw new Error("No response content received");
			}
		} catch (error) {
			if (error instanceof Error && error.message === "No response content received") {
				throw error;
			}
			
			// Handle API errors
			return stream 
				? ErrorHandler.handleStreamingApiError(error)
				: ErrorHandler.handleApiError(error);
		}
	}
}