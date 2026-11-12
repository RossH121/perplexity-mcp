/**
 * Handler for the list_models tool — dynamic model discovery via GET /v1/models.
 * Returns the live catalog of models available to the account (Sonar + any
 * provider-qualified third-party models usable through the Agent API), optionally
 * filtered by provider. Distinct from `get_model_info`/`set_model`, which manage the stateful
 * Sonar model selection for the `search` tool.
 */

import { McpRequest, HandlerContext, ModelListArgs, ModelListEntry } from "../schemas/types.js";
import { isValidModelListArgs } from "../schemas/validation.js";
import { PerplexityApiService } from "../services/PerplexityApiService.js";
import { ErrorHandler } from "../utils/errorHandling.js";
import { structuredResult } from "../utils/structuredResult.js";

export class ModelListHandler {
	constructor(private apiService: PerplexityApiService) {}

	async handle(request: McpRequest, ctx: HandlerContext = {}) {
		if (!isValidModelListArgs(request.params.arguments)) {
			throw ErrorHandler.validationError(
				"Invalid list_models arguments. 'provider' must be a string if provided."
			);
		}

		const args = (request.params.arguments ?? {}) as ModelListArgs;

		try {
			const response = await this.apiService.listModels(ctx);
			let models: ModelListEntry[] = Array.isArray(response?.data) ? response.data : [];

			const providerFilter = args.provider?.trim().toLowerCase();
			if (providerFilter) {
				models = models.filter(
					(m) => (m.owned_by ?? "").toLowerCase() === providerFilter
				);
			}

			const data = {
				provider_filter: providerFilter || null,
				count: models.length,
				models: models
					.filter((m) => typeof m?.id === "string")
					.map((m) => ({ id: m.id, provider: m.owned_by?.trim() || "unknown" })),
			};

			if (models.length === 0) {
				const suffix = providerFilter ? ` for provider '${args.provider}'` : "";
				return structuredResult(`No models found${suffix}.`, data);
			}

			// Group by provider (owned_by) for readable discovery.
			const byProvider = new Map<string, string[]>();
			for (const m of models) {
				const provider = m.owned_by?.trim() || "unknown";
				if (!byProvider.has(provider)) byProvider.set(provider, []);
				byProvider.get(provider)!.push(m.id);
			}

			const lines: string[] = [];
			lines.push(`Available models (${models.length} total):`);
			lines.push("");
			for (const provider of [...byProvider.keys()].sort()) {
				const ids = byProvider.get(provider)!.sort();
				lines.push(`## ${provider} (${ids.length})`);
				for (const id of ids) lines.push(`- ${id}`);
				lines.push("");
			}

			return structuredResult(lines.join("\n").trimEnd(), data);
		} catch (error) {
			return ErrorHandler.handleApiError(error);
		}
	}
}
