/**
 * Service for communicating with the Perplexity AI API
 * Uses the official @perplexity-ai/perplexity_ai SDK
 */

import Perplexity from "@perplexity-ai/perplexity_ai";
import { SearchResponse, ApiParams, RawSearchArgs, RawSearchResult } from "../schemas/types.js";
import { API_CONFIG } from "../config/constants.js";
import { EnvironmentConfig } from "../config/environment.js";

export class PerplexityApiService {
	private client: Perplexity;

	constructor(private config: EnvironmentConfig) {
		this.client = new Perplexity({
			apiKey: this.config.apiKey,
			timeout: API_CONFIG.TIMEOUT,
		});
	}

	/**
	 * Performs a chat-based search using the Perplexity API
	 */
	async search(apiParams: ApiParams): Promise<SearchResponse> {
		const { stream, ...params } = apiParams;
		const response = await (this.client.chat.completions.create as Function)({
			...params,
			stream: false,
		});
		return response as SearchResponse;
	}

	/**
	 * Handles streaming search responses
	 */
	async searchStream(apiParams: ApiParams): Promise<{
		content: string;
		search_results?: Array<{ title: string; url: string; date?: string; snippet?: string }>;
	}> {
		const { stream, ...params } = apiParams;
		const streamResponse = await (this.client.chat.completions.create as Function)({
			...params,
			stream: true,
		});

		let fullContent = "";
		let search_results: Array<{ title: string; url: string; date?: string; snippet?: string }> | undefined;

		for await (const chunk of streamResponse) {
			const content = chunk.choices?.[0]?.delta?.content;
			if (content) {
				fullContent += content;
			}
			if (chunk.search_results) {
				search_results = chunk.search_results;
			}
		}

		return { content: fullContent, search_results };
	}

	/**
	 * Performs a raw search using the Perplexity /search endpoint (no LLM synthesis)
	 */
	async rawSearch(args: RawSearchArgs): Promise<RawSearchResult[]> {
		const params: Record<string, unknown> = {
			query: args.query,
		};

		if (args.max_results !== undefined) params["maxResults"] = args.max_results;
		if (args.search_mode !== undefined) params["searchMode"] = args.search_mode;
		if (args.recency !== undefined) params["searchRecencyFilter"] = args.recency;
		if (args.search_after_date !== undefined) params["searchAfterDateFilter"] = args.search_after_date;
		if (args.search_before_date !== undefined) params["searchBeforeDateFilter"] = args.search_before_date;
		if (args.country !== undefined) params["country"] = args.country;

		const response = await (this.client.search.create as Function)(params);
		return (response.results ?? []) as RawSearchResult[];
	}

	/**
	 * Creates API parameters for a search request
	 */
	createApiParams(
		model: string,
		query: string,
		domainFilters?: string[],
		recencyFilter?: string,
		stream?: boolean,
		searchContextSize?: "low" | "medium" | "high",
		reasoningEffort?: "minimal" | "low" | "medium" | "high",
		searchMode?: "web" | "academic" | "sec",
	): ApiParams {
		const apiParams: ApiParams = {
			model,
			messages: [
				{
					role: "system",
					content: "You are a helpful assistant that searches the web for accurate information.",
				},
				{
					role: "user",
					content: query,
				},
			],
		};

		if (domainFilters && domainFilters.length > 0) {
			apiParams.search_domain_filter = domainFilters;
		}

		if (recencyFilter) {
			apiParams.search_recency_filter = recencyFilter;
		}

		if (searchContextSize) {
			apiParams.web_search_options = { search_context_size: searchContextSize };
		}

		if (reasoningEffort) {
			apiParams.reasoning_effort = reasoningEffort;
		}

		if (searchMode) {
			apiParams.search_mode = searchMode;
		}

		if (stream) {
			apiParams.stream = true;
		}

		return apiParams;
	}
}
