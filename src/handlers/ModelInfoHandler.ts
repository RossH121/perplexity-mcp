/**
 * Handler for model info tool functionality
 */

import { McpRequest, ModelArgs } from "../schemas/types.js";
import { isValidModelArgs } from "../schemas/validation.js";
import { ModelSelectionService } from "../services/ModelSelectionService.js";
import { EnvironmentConfig } from "../config/environment.js";
import { MODEL_SELECTION_MAP } from "../config/constants.js";
import { ErrorHandler } from "../utils/errorHandling.js";
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";

export class ModelInfoHandler {
	constructor(
		private modelSelectionService: ModelSelectionService,
		private config: EnvironmentConfig,
		private getCurrentModel: () => string,
		private setCurrentModel: (model: string) => void,
		private getUseAutoSelection: () => boolean,
		private setUseAutoSelection: (value: boolean) => void
	) {}

	async handle(request: McpRequest) {
		if (!isValidModelArgs(request.params.arguments)) {
			throw ErrorHandler.createMcpError(
				ErrorCode.InvalidParams,
				"Invalid model argument. Model must be one of the valid models or not provided."
			);
		}

		// If a specific model is requested, set it and disable auto-selection
		const { model } = request.params.arguments as ModelArgs;
		if (model) {
			this.setCurrentModel(model);
			this.setUseAutoSelection(false);
		} else {
			// If no model specified, reset to default and re-enable auto-selection
			this.setCurrentModel(this.config.defaultModel);
			this.setUseAutoSelection(true);
		}

		// Build model information text
		const modelInfoLines: string[] = [];

		// Current model status
		if (model) {
			modelInfoLines.push(`Model has been set to: ${this.getCurrentModel()}`);
			modelInfoLines.push(
				"Auto-selection: DISABLED (will only switch if query has strong intent matching)"
			);
			modelInfoLines.push(
				"To re-enable auto-selection, run model_info with no parameters"
			);
			modelInfoLines.push("");
		} else {
			modelInfoLines.push(
				`Current model: ${this.getCurrentModel()} (reset to default)`
			);
			modelInfoLines.push(`Default model (from environment): ${this.config.defaultModel}`);
			modelInfoLines.push(
				"Auto-selection: ENABLED (model will be selected based on query keywords)"
			);
			modelInfoLines.push("");
		}

		// List available models with descriptions
		modelInfoLines.push("Available models:");
		for (const [modelName, criteria] of Object.entries(MODEL_SELECTION_MAP)) {
			modelInfoLines.push(`- ${modelName}: ${criteria.description}`);
			modelInfoLines.push(`  Keywords: ${criteria.keywords.join(", ")}`);
		}

		// Instructions
		modelInfoLines.push("");
		modelInfoLines.push(
			"To use automatic model selection: Call this tool with no parameters"
		);
		modelInfoLines.push(
			'To set a specific model: Use this tool with the "model" parameter'
		);

		return {
			content: [
				{
					type: "text",
					text: modelInfoLines.join("\n"),
				},
			],
		};
	}
}