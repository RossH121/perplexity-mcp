/**
 * Handler for search tool functionality.
 *
 * Two backends, chosen per call by PERPLEXITY_SEARCH_BACKEND:
 * - "agent" (default): the Agent API (client.responses.create). The Sonar
 *   model picked by keyword routing / set_model (or a per-call `effort` override) is mapped to an effort level
 *   (sonar/sonar-pro -> fast, sonar-reasoning-pro -> low, sonar-deep-research
 *   -> high) and the Sonar-style params are translated by
 *   buildAgentSearchRequest(). Params with no Agent equivalent are reported in
 *   a "Backend notes" section rather than dropped silently.
 * - "sonar": the legacy Sonar Chat Completions path (end of support
 *   2026-09-27; kept as a rollback switch while it still answers).
 */

import { McpRequest, HandlerContext, SearchArgs } from "../schemas/types.js";
import { isValidSearchArgs, searchDomainFilterError } from "../schemas/validation.js";
import { PerplexityApiService } from "../services/PerplexityApiService.js";
import { ModelSelectionService } from "../services/ModelSelectionService.js";
import { buildAgentSearchRequest } from "../services/agentSearchRequest.js";
import { FilterState } from "../models/FilterState.js";
import { structuredResult, numOrNull, strOrNull, toImages, toSources } from "../utils/structuredResult.js";
import { ErrorHandler } from "../utils/errorHandling.js";
import type { ModelSelectionState } from "./ModelInfoHandler.js";
import { resolveSearchBackend } from "../config/constants.js";
import {
	stripThinkingBlocks,
	normalizeMessageContent,
	renderResponseExtras,
	extractAgentOutput,
	renderAgentSources,
	renderImages,
	renderCostFooter,
	renderBackendNotes,
} from "../utils/responseFormatting.js";

const NO_CONTENT = "No response content received";

/**
 * One long-lived instance. The stateful model selection (set_model) and
 * filters (domain_filter / recency_filter) are read synchronously at the start
 * of each call, before any await, so every call works from one consistent
 * snapshot even when set_model or a filter tool runs in parallel with it.
 */
/** structuredContent for a legacy Sonar search result (search outputSchema). */
function sonarStructured(answer: string, model: string, r: any, notes: string[] = []): Record<string, unknown> {
	return {
		answer,
		backend: "sonar",
		model,
		effort: null,
		model_ran: strOrNull(r?.model),
		status: null,
		sources: toSources(r?.search_results),
		images: toImages(r?.images),
		related_questions: (Array.isArray(r?.related_questions) ? r.related_questions : []).filter((q: unknown) => typeof q === "string"),
		cost_usd: numOrNull(r?.usage?.cost?.total_cost),
		notes,
	};
}

export class SearchHandler {
	constructor(
		private apiService: PerplexityApiService,
		private modelSelectionService: ModelSelectionService,
		private filterState: FilterState,
		private getModelState: () => ModelSelectionState
	) {}

	async handle(request: McpRequest, ctx: HandlerContext = {}) {
		const rawArgs = request.params.arguments as Record<string, unknown> | undefined;
		if (rawArgs?.search_domain_filter !== undefined) {
			const domainError = searchDomainFilterError(rawArgs.search_domain_filter);
			if (domainError) throw ErrorHandler.validationError(`Invalid search arguments. ${domainError}`);
		}
		if (!isValidSearchArgs(request.params.arguments)) {
			throw ErrorHandler.validationError(
				"Invalid search arguments. Query must be a non-empty string."
			);
		}

		const args = request.params.arguments as SearchArgs;
		const { selectedModel, description } = this.selectModel(args.query, this.getModelState());

		// Domain filters and recency. Per-call args.search_domain_filter and
		// args.recency override the stateful domain_filter / recency_filter for
		// this request only, without mutating them ([] = no domain filter).
		const domainFilterArray = args.search_domain_filter ?? this.filterState.getDomainFilterArray();
		const domainFilters = domainFilterArray.length > 0 ? domainFilterArray : undefined;
		const recencyFilter = args.recency ?? (this.filterState.getRecencyFilter() || undefined);

		if (resolveSearchBackend() === "sonar") {
			return this.handleSonar(args, selectedModel, description, domainFilters, recencyFilter, ctx);
		}
		return this.handleAgent(args, selectedModel, description, domainFilters, recencyFilter, ctx);
	}

	private selectModel(
		query: string,
		{ currentModel, useAutoSelection }: ModelSelectionState
	): { selectedModel: string; description: string } {
		const selection = this.modelSelectionService.selectModelBasedOnIntent(query);
		if (useAutoSelection) {
			return { selectedModel: selection.model, description: selection.description };
		}
		if (selection.score >= 2 && selection.model !== currentModel) {
			return {
				selectedModel: selection.model,
				description: `${selection.description} (auto-selected based on query intent)`,
			};
		}
		return {
			selectedModel: currentModel,
			description: this.modelSelectionService.getModelDescription(currentModel),
		};
	}

	private async handleAgent(
		args: SearchArgs,
		selectedModel: string,
		description: string,
		domainFilters: string[] | undefined,
		recencyFilter: string | undefined,
		ctx: HandlerContext
	) {
		const { body, effort, notes } = buildAgentSearchRequest({
			sonarModel: selectedModel,
			query: args.query,
			domainFilters,
			recencyFilter,
			args,
		});

		let resp: any;
		try {
			resp = await this.apiService.agentSearch(body, ctx);
		} catch (error) {
			return ErrorHandler.handleApiError(error);
		}

		const { text: rawText, searchResults, images } = extractAgentOutput(resp);
		const status: string | undefined = resp?.status;
		if (!rawText) {
			const detail = resp?.error?.message ?? resp?.incomplete_details?.reason;
			throw new Error(
				status && status !== "completed"
					? `${NO_CONTENT} (status: ${status}${detail ? `, ${detail}` : ""})`
					: NO_CONTENT
			);
		}
		const text = args.strip_thinking ? stripThinkingBlocks(rawText) : rawText;

		// Header keeps the Sonar model name (what routing/set_model speak) and
		// adds what actually ran, so callers can see the mapping.
		const ran = [resp?.effort ?? effort, resp?.model].filter(Boolean).join(" on ");
		const route = effort ? `Agent effort ${effort}` : `Agent model ${resp?.model ?? body["model"]}`;
		let out =
			args.effort !== undefined && effort
				? `[Using effort override: ${effort}${ran ? ` (ran ${ran})` : ""} - keyword routing bypassed]\n\n`
				: `[Using model: ${selectedModel} -> ${route}${ran ? ` (ran ${ran})` : ""} - ${description}]\n\n`;
		if (status && status !== "completed") out += `[status: ${status}]\n\n`;
		out += text;
		out += renderAgentSources(searchResults);
		out += renderImages(images);
		if (args.show_cost) out += renderCostFooter(resp?.usage);
		out += renderBackendNotes(notes);
		return structuredResult(out, {
			answer: text,
			backend: "agent",
			model: selectedModel,
			effort: strOrNull(resp?.effort ?? effort),
			model_ran: strOrNull(resp?.model),
			status: strOrNull(status),
			sources: toSources(searchResults),
			images: toImages(images),
			related_questions: [],
			cost_usd: numOrNull(resp?.usage?.cost?.total_cost),
			notes: (notes ?? []).map(String),
		});
	}

	private async handleSonar(
		args: SearchArgs,
		selectedModel: string,
		description: string,
		domainFilters: string[] | undefined,
		recencyFilter: string | undefined,
		ctx: HandlerContext
	) {
		const { query, stream = false, strip_thinking, show_cost } = args;
		try {
			const apiParams = this.apiService.createApiParams({
				model: selectedModel,
				query,
				domainFilters,
				recencyFilter,
				args,
			});

			const effortNote = args.effort !== undefined ? `; effort '${args.effort}' ignored, it is agent-backend only` : "";
			const modelInfo = `[Using model: ${selectedModel} (legacy Sonar backend${effortNote}) - ${description}]\n\n`;
			const sonarNotes = args.effort !== undefined ? [`effort '${args.effort}' ignored, it is agent-backend only`] : [];

			if (stream) {
				const streamResult = await this.apiService.searchStream(apiParams, ctx);
				let content = streamResult.content;
				if (strip_thinking) content = stripThinkingBlocks(content);
				const responseText = modelInfo + content + renderResponseExtras(streamResult, !!show_cost);
				return structuredResult(responseText, sonarStructured(content, selectedModel, streamResult, sonarNotes));
			}

			const response = await this.apiService.search(apiParams, ctx);
			if (response.choices && response.choices.length > 0) {
				let content = normalizeMessageContent(response.choices[0].message.content);
				if (strip_thinking) content = stripThinkingBlocks(content);
				const responseText = modelInfo + content + renderResponseExtras(response, !!show_cost);
				return structuredResult(responseText, sonarStructured(content, selectedModel, response, sonarNotes));
			}
			throw new Error(NO_CONTENT);
		} catch (error) {
			if (error instanceof Error && error.message === NO_CONTENT) {
				throw error;
			}
			return stream
				? ErrorHandler.handleStreamingApiError(error)
				: ErrorHandler.handleApiError(error);
		}
	}
}
