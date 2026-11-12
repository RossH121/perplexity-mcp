/**
 * Handler for the embeddings tool — Perplexity Embeddings API.
 * Returns a compact summary by default; raw vectors only when `full: true`.
 */

import { McpRequest, HandlerContext, EmbeddingsArgs } from "../schemas/types.js";
import { isValidEmbeddingsArgs } from "../schemas/validation.js";
import { PerplexityApiService } from "../services/PerplexityApiService.js";
import { ErrorHandler } from "../utils/errorHandling.js";
import { structuredResult, intOrNull, numOrNull } from "../utils/structuredResult.js";
import { formatUsd } from "../utils/formatUsd.js";
import { DEFAULT_EMBEDDING_MODEL } from "../config/constants.js";

// Per-model default output dimension (used when `dimensions` is not requested).
const MODEL_DEFAULT_DIMENSIONS: Record<string, number> = {
	"pplx-embed-v1-0.6b": 1024,
	"pplx-embed-v1-4b": 2560,
};

export class EmbeddingsHandler {
	constructor(private apiService: PerplexityApiService) {}

	async handle(request: McpRequest, ctx: HandlerContext = {}) {
		if (!isValidEmbeddingsArgs(request.params.arguments)) {
			throw ErrorHandler.validationError(
				"Invalid embeddings arguments. 'input' must be a non-empty string or array of strings."
			);
		}

		const args = request.params.arguments as EmbeddingsArgs;

		try {
			const resp = await this.apiService.createEmbeddings(args, ctx);
			const data: any[] = resp?.data ?? [];

			const effectiveModel = resp?.model ?? args.model ?? DEFAULT_EMBEDDING_MODEL;

			const lines: string[] = [
				"## Embeddings",
				`Model: ${effectiveModel}`,
				`Vectors: ${data.length}`,
			];
			if (args.dimensions !== undefined) {
				lines.push(`Dimensions: ${args.dimensions} (requested)`);
			} else {
				const modelDefault = MODEL_DEFAULT_DIMENSIONS[effectiveModel];
				if (modelDefault !== undefined) {
					lines.push(`Dimensions: ${modelDefault} (model default)`);
				}
			}
			if (resp?.usage?.total_tokens !== undefined) lines.push(`Tokens: ${resp.usage.total_tokens}`);
			if (resp?.usage?.cost?.total_cost !== undefined) lines.push(`Cost: ${formatUsd(resp.usage.cost.total_cost)}`);
			lines.push(`Encoding: ${args.encoding_format ?? "base64_int8 (API default)"}`);

			const modelDim = MODEL_DEFAULT_DIMENSIONS[effectiveModel];
			const data_: Record<string, unknown> = {
				model: effectiveModel,
				count: data.length,
				dimensions: args.dimensions ?? modelDim ?? null,
				dimensions_source: args.dimensions !== undefined ? "requested" : modelDim !== undefined ? "model_default" : null,
				encoding: args.encoding_format ?? "base64_int8",
				tokens: intOrNull(resp?.usage?.total_tokens),
				cost_usd: numOrNull(resp?.usage?.cost?.total_cost),
			};
			if (args.full) data_.vectors = data.map((d: any) => (typeof d?.embedding === "string" ? d.embedding : ""));

			if (args.full) {
				lines.push("", "### Vectors (base64-encoded)");
				data.forEach((d: any, i: number) => {
					lines.push(`[${i}] ${d.embedding ?? ""}`);
				});
			} else {
				lines.push("", "_Raw vectors omitted. Pass `full: true` to include the base64-encoded embeddings._");
			}

			return structuredResult(lines.join("\n"), data_);
		} catch (error) {
			return ErrorHandler.handleApiError(error);
		}
	}
}
