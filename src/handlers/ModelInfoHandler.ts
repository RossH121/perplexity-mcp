/**
 * Handlers for the stateful Sonar model selection used by `search`.
 *
 * - get_model_info (handleGet): read-only view of the current model,
 *   auto-selection state and the routing table.
 * - set_model (handleSet): override the model, or "auto" to reset to the
 *   default with keyword auto-selection.
 * - model_info (handle): DEPRECATED combined view/set alias, kept for one
 *   release. With `model` it sets; with no args it RESETS to the default (the
 *   original behaviour), which is why it was never read-only.
 */

import { structuredResult } from "../utils/structuredResult.js";
import { McpRequest, HandlerContext, ModelArgs, SetModelArgs } from "../schemas/types.js";
import { isValidModelArgs, isValidSetModelArgs } from "../schemas/validation.js";
import { EnvironmentConfig } from "../config/environment.js";
import { MODEL_SELECTION_MAP } from "../config/constants.js";
import { ErrorHandler } from "../utils/errorHandling.js";

/** Snapshot of the model-selection state, read once per call. */
export interface ModelSelectionState {
	currentModel: string;
	useAutoSelection: boolean;
}

export class ModelInfoHandler {
	constructor(
		private config: EnvironmentConfig,
		private getState: () => ModelSelectionState,
		private setState: (state: ModelSelectionState) => void
	) {}

	/** get_model_info: no args, changes nothing. */
	async handleGet(_request?: McpRequest, _ctx: HandlerContext = {}) {
		const { currentModel, useAutoSelection } = this.getState();
		const lines = [
			`Current model: ${currentModel}`,
			`Default model (from environment): ${this.config.defaultModel}`,
			useAutoSelection
				? "Auto-selection: ENABLED (model is selected from query keywords)"
				: "Auto-selection: DISABLED (the current model is used unless the query has strong intent matching)",
			"",
			...this.availableModelLines(),
			"",
			'To override: set_model { model: "<id>" }. To restore auto-selection: set_model { model: "auto" }.',
			"Per call, search's 'effort' param bypasses this selection entirely (agent backend).",
		];
		return structuredResult(lines.join("\n"), {
			current_model: currentModel,
			default_model: this.config.defaultModel,
			auto_selection: useAutoSelection,
			available_models: Object.entries(MODEL_SELECTION_MAP).map(([id, c]) => ({
				id,
				description: String(c.description ?? ""),
				keywords: [...(c.keywords ?? [])].map(String),
			})),
		});
	}

	/** set_model: model id, or "auto" to reset to the default with auto-selection. */
	async handleSet(request: McpRequest, _ctx: HandlerContext = {}) {
		if (!isValidSetModelArgs(request.params.arguments)) {
			throw ErrorHandler.validationError(
				`Invalid set_model arguments. 'model' is required: one of ${Object.keys(MODEL_SELECTION_MAP).join(", ")}, or "auto".`
			);
		}
		const { model } = request.params.arguments as SetModelArgs;
		return this.apply(model === "auto" ? undefined : model);
	}

	/** DEPRECATED model_info alias: same behaviour as before the split. */
	async handle(request: McpRequest, _ctx: HandlerContext = {}) {
		if (!isValidModelArgs(request.params.arguments)) {
			throw ErrorHandler.validationError(
				"Invalid model argument. Model must be one of the valid models or not provided."
			);
		}
		const { model } = request.params.arguments as ModelArgs;
		const result = await this.apply(model);
		result.content[0].text +=
			"\n\nNote: model_info is deprecated; use get_model_info (read-only) and set_model.";
		return result;
	}

	private async apply(model: string | undefined) {
		const lines: string[] = [];
		if (model) {
			this.setState({ currentModel: model, useAutoSelection: false });
			lines.push(
				`Model has been set to: ${model}`,
				"Auto-selection: DISABLED (will only switch if query has strong intent matching)",
				'To re-enable auto-selection: set_model { model: "auto" }'
			);
		} else {
			this.setState({ currentModel: this.config.defaultModel, useAutoSelection: true });
			lines.push(
				`Current model: ${this.config.defaultModel} (reset to default)`,
				`Default model (from environment): ${this.config.defaultModel}`,
				"Auto-selection: ENABLED (model will be selected based on query keywords)"
			);
		}
		lines.push("", ...this.availableModelLines());
		return { content: [{ type: "text" as const, text: lines.join("\n") }] };
	}

	private availableModelLines(): string[] {
		const lines = ["Available models:"];
		for (const [modelName, criteria] of Object.entries(MODEL_SELECTION_MAP)) {
			lines.push(`- ${modelName}: ${criteria.description}`);
			lines.push(`  Keywords: ${criteria.keywords.join(", ")}`);
		}
		return lines;
	}
}
