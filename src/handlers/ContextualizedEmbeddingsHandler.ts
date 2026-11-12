/**
 * Handler for the contextualized_embeddings tool, Perplexity Contextualized
 * Embeddings API (client.contextualizedEmbeddings.create). Distinct from
 * `embeddings`: input is a nested array of document chunks, and chunks in the
 * same document share context awareness for better retrieval quality.
 * Returns a compact summary by default; raw vectors only when `full: true`.
 */

import { McpRequest, HandlerContext, ContextualizedEmbeddingsArgs } from "../schemas/types.js";
import { isValidContextualizedEmbeddingsArgs } from "../schemas/validation.js";
import { PerplexityApiService } from "../services/PerplexityApiService.js";
import { ErrorHandler } from "../utils/errorHandling.js";
import { structuredResult, intOrNull, numOrNull } from "../utils/structuredResult.js";
import { formatUsd } from "../utils/formatUsd.js";
import { DEFAULT_CONTEXTUALIZED_EMBEDDING_MODEL } from "../config/constants.js";

const MODEL_DEFAULT_DIMENSIONS: Record<string, number> = {
	"pplx-embed-context-v1-0.6b": 1024,
	"pplx-embed-context-v1-4b": 2560,
};

export class ContextualizedEmbeddingsHandler {
	constructor(private apiService: PerplexityApiService) {}

	async handle(request: McpRequest, ctx: HandlerContext = {}) {
		if (!isValidContextualizedEmbeddingsArgs(request.params.arguments)) {
			throw ErrorHandler.validationError(
				"Invalid contextualized_embeddings arguments. 'input' must be a non-empty array of non-empty string arrays (max 512 documents, 16000 chunks total)."
			);
		}

		const args = request.params.arguments as ContextualizedEmbeddingsArgs;

		try {
			const resp = await this.apiService.createContextualizedEmbeddings(args, ctx);
			const data: any[] = resp?.data ?? [];
			const effectiveModel = resp?.model ?? args.model ?? DEFAULT_CONTEXTUALIZED_EMBEDDING_MODEL;
			const chunkCount = data.reduce((n: number, doc: any) => n + (doc?.data?.length ?? 0), 0);

			const lines: string[] = [
				"## Contextualized Embeddings",
				`Model: ${effectiveModel}`,
				`Documents: ${data.length}`,
				`Chunks: ${chunkCount}`,
			];
			if (args.dimensions !== undefined) {
				lines.push(`Dimensions: ${args.dimensions} (requested)`);
			} else {
				const modelDefault = MODEL_DEFAULT_DIMENSIONS[effectiveModel];
				if (modelDefault !== undefined) lines.push(`Dimensions: ${modelDefault} (model default)`);
			}
			if (resp?.usage?.total_tokens !== undefined) lines.push(`Tokens: ${resp.usage.total_tokens}`);
			if (resp?.usage?.cost?.total_cost !== undefined) lines.push(`Cost: ${formatUsd(resp.usage.cost.total_cost)}`);
			lines.push(`Encoding: ${args.encoding_format ?? "base64_int8 (API default)"}`);

			const modelDim = MODEL_DEFAULT_DIMENSIONS[effectiveModel];
			const summary: Record<string, unknown> = {
				model: effectiveModel,
				documents: data.length,
				chunks: chunkCount,
				dimensions: args.dimensions ?? modelDim ?? null,
				dimensions_source: args.dimensions !== undefined ? "requested" : modelDim !== undefined ? "model_default" : null,
				encoding: args.encoding_format ?? "base64_int8",
				tokens: intOrNull(resp?.usage?.total_tokens),
				cost_usd: numOrNull(resp?.usage?.cost?.total_cost),
			};
			if (args.full) {
				summary.vectors = data.map((doc: any) =>
					(doc?.data ?? []).map((c: any) => (typeof c?.embedding === "string" ? c.embedding : ""))
				);
			}

			if (args.full) {
				lines.push("", "### Vectors (base64-encoded, by document)");
				data.forEach((doc: any, docIndex: number) => {
					lines.push(`[doc ${docIndex}]`);
					(doc?.data ?? []).forEach((chunk: any, chunkIndex: number) => {
						lines.push(`  [chunk ${chunkIndex}] ${chunk.embedding ?? ""}`);
					});
				});
			} else {
				lines.push("", "_Raw vectors omitted. Pass `full: true` to include the base64-encoded embeddings._");
			}

			return structuredResult(lines.join("\n"), summary);
		} catch (error) {
			return ErrorHandler.handleApiError(error);
		}
	}
}
