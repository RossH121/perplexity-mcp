/**
 * Handler for the embeddings tool — Perplexity Embeddings API.
 * Returns a compact summary by default; raw vectors only when `full: true`.
 */

import { McpRequest, EmbeddingsArgs } from "../schemas/types.js";
import { isValidEmbeddingsArgs } from "../schemas/validation.js";
import { PerplexityApiService } from "../services/PerplexityApiService.js";
import { ErrorHandler } from "../utils/errorHandling.js";
import { DEFAULT_EMBEDDING_MODEL } from "../config/constants.js";
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";

// Per-model default output dimension (used when `dimensions` is not requested).
const MODEL_DEFAULT_DIMENSIONS: Record<string, number> = {
	"pplx-embed-v1-0.6b": 1024,
	"pplx-embed-v1-4b": 2560,
};

export class EmbeddingsHandler {
	constructor(private apiService: PerplexityApiService) {}

	async handle(request: McpRequest) {
		if (!isValidEmbeddingsArgs(request.params.arguments)) {
			throw ErrorHandler.createMcpError(
				ErrorCode.InvalidParams,
				"Invalid embeddings arguments. 'input' must be a non-empty string or array of strings."
			);
		}

		const args = request.params.arguments as EmbeddingsArgs;

		try {
			const resp = await this.apiService.createEmbeddings(args);
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
			if (resp?.usage?.cost?.total_cost !== undefined) lines.push(`Cost: $${resp.usage.cost.total_cost}`);

			if (args.full) {
				lines.push("", "### Vectors (base64-encoded)");
				data.forEach((d: any, i: number) => {
					lines.push(`[${i}] ${d.embedding ?? ""}`);
				});
			} else {
				lines.push("", "_Raw vectors omitted. Pass `full: true` to include the base64-encoded embeddings._");
			}

			return { content: [{ type: "text", text: lines.join("\n") }] };
		} catch (error) {
			return ErrorHandler.handleApiError(error);
		}
	}
}
