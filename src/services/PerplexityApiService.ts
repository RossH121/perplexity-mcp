/**
 * Service for communicating with the Perplexity AI API
 * Uses the official @perplexity-ai/perplexity_ai SDK
 */

import Perplexity from "@perplexity-ai/perplexity_ai";
import {
	SearchResponse,
	StreamChunk,
	ApiParams,
	RawSearchArgs,
	RawSearchResult,
	CreateApiParamsOptions,
	WebSearchOptions,
	AgentArgs,
	EmbeddingsArgs,
	SearchResultItem,
	ResponseImage,
} from "../schemas/types.js";
import { API_CONFIG, DEFAULT_EMBEDDING_MODEL } from "../config/constants.js";
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
		search_results?: SearchResultItem[];
		images?: ResponseImage[];
		related_questions?: string[];
		usage?: StreamChunk["usage"];
	}> {
		const { stream, ...params } = apiParams;
		const streamResponse = await (this.client.chat.completions.create as Function)({
			...params,
			stream: true,
		});

		let fullContent = "";
		let search_results: SearchResultItem[] | undefined;
		let images: ResponseImage[] | undefined;
		let related_questions: string[] | undefined;
		let usage: StreamChunk["usage"];

		for await (const chunk of streamResponse as AsyncIterable<StreamChunk>) {
			const content = chunk.choices?.[0]?.delta?.content;
			if (content) {
				fullContent += content;
			}
			// NOTE: search_results/images/related_questions/usage populate on the
			// terminal chunk only; the non-stream search() path is the verified one.
			if (chunk.search_results) search_results = chunk.search_results;
			if (chunk.images) images = chunk.images;
			if (chunk.related_questions) related_questions = chunk.related_questions;
			if (chunk.usage) usage = chunk.usage;
		}

		return { content: fullContent, search_results, images, related_questions, usage };
	}

	/**
	 * Performs a raw search using the Perplexity /search endpoint (no LLM synthesis).
	 * NOTE: the SDK expects snake_case body keys; camelCase keys are silently ignored.
	 */
	async rawSearch(args: RawSearchArgs): Promise<RawSearchResult[]> {
		const params: Record<string, unknown> = {
			query: args.query,
		};

		if (args.max_results !== undefined) params["max_results"] = args.max_results;
		if (args.max_tokens !== undefined) params["max_tokens"] = args.max_tokens;
		if (args.max_tokens_per_page !== undefined) params["max_tokens_per_page"] = args.max_tokens_per_page;
		if (args.search_mode !== undefined) params["search_mode"] = args.search_mode;
		if (args.search_type !== undefined) params["search_type"] = args.search_type;
		if (args.recency !== undefined) params["search_recency_filter"] = args.recency;
		if (args.search_after_date !== undefined) params["search_after_date_filter"] = args.search_after_date;
		if (args.search_before_date !== undefined) params["search_before_date_filter"] = args.search_before_date;
		if (args.last_updated_after !== undefined) params["last_updated_after_filter"] = args.last_updated_after;
		if (args.last_updated_before !== undefined) params["last_updated_before_filter"] = args.last_updated_before;
		if (args.search_language_filter !== undefined) params["search_language_filter"] = args.search_language_filter;
		if (args.country !== undefined) params["country"] = args.country;

		const response = await (this.client.search.create as Function)(params);
		return (response.results ?? []) as RawSearchResult[];
	}

	/**
	 * Submits an asynchronous deep-research job (fire-and-poll). 7-day TTL.
	 */
	async submitAsyncResearch(request: ApiParams): Promise<any> {
		const { stream, ...req } = request;
		return (this.client as any).async.chat.completions.create({ request: req });
	}

	/**
	 * Polls a single async job by request id.
	 */
	async getAsyncResearch(requestId: string): Promise<any> {
		return (this.client as any).async.chat.completions.get(requestId);
	}

	/**
	 * Lists async jobs for the authenticated account.
	 */
	async listAsyncResearch(): Promise<any> {
		return (this.client as any).async.chat.completions.list();
	}

	/**
	 * Agent API call via the OpenAI-compatible responses surface.
	 */
	async agentRespond(args: AgentArgs): Promise<any> {
		const body: Record<string, unknown> = { input: args.input };
		if (args.model !== undefined) body["model"] = args.model;
		if (args.models !== undefined) body["models"] = args.models;
		if (args.preset !== undefined) body["preset"] = args.preset;
		if (args.instructions !== undefined) body["instructions"] = args.instructions;
		if (args.max_steps !== undefined) body["max_steps"] = args.max_steps;
		if (args.max_output_tokens !== undefined) body["max_output_tokens"] = args.max_output_tokens;
		if (args.language_preference !== undefined) body["language_preference"] = args.language_preference;
		if (args.tools !== undefined) body["tools"] = args.tools.map((t) => ({ type: t }));
		body["stream"] = false;
		return (this.client.responses.create as Function)(body);
	}

	/**
	 * Creates embeddings for one or more input strings.
	 */
	async createEmbeddings(args: EmbeddingsArgs): Promise<any> {
		const body: Record<string, unknown> = {
			input: args.input,
			model: args.model ?? DEFAULT_EMBEDDING_MODEL,
		};
		if (args.dimensions !== undefined) body["dimensions"] = args.dimensions;
		return (this.client.embeddings.create as Function)(body);
	}

	/**
	 * Creates API parameters for a chat-completion search request.
	 * Accepts an options object (avoids an unreadable positional signature).
	 */
	createApiParams(options: CreateApiParamsOptions): ApiParams {
		const { model, query, domainFilters, recencyFilter, args, systemPrompt } = options;

		const apiParams: ApiParams = {
			model,
			messages: [
				{
					role: "system",
					content:
						systemPrompt ??
						"You are a helpful assistant that searches the web for accurate information.",
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

		// web_search_options (search_context_size, search_type, user_location)
		const webSearchOptions: WebSearchOptions = {};
		if (args.search_context_size) webSearchOptions.search_context_size = args.search_context_size;
		if (args.search_type) webSearchOptions.search_type = args.search_type;
		if (args.country !== undefined || args.latitude !== undefined || args.longitude !== undefined) {
			webSearchOptions.user_location = {
				...(args.latitude !== undefined ? { latitude: args.latitude } : {}),
				...(args.longitude !== undefined ? { longitude: args.longitude } : {}),
				...(args.country !== undefined ? { country: args.country } : {}),
			};
		}
		if (Object.keys(webSearchOptions).length > 0) {
			apiParams.web_search_options = webSearchOptions;
		}

		if (args.reasoning_effort) apiParams.reasoning_effort = args.reasoning_effort;
		if (args.search_mode) apiParams.search_mode = args.search_mode;
		if (args.search_after_date !== undefined) apiParams.search_after_date_filter = args.search_after_date;
		if (args.search_before_date !== undefined) apiParams.search_before_date_filter = args.search_before_date;
		if (args.last_updated_after !== undefined) apiParams.last_updated_after_filter = args.last_updated_after;
		if (args.last_updated_before !== undefined) apiParams.last_updated_before_filter = args.last_updated_before;
		if (args.search_language_filter !== undefined) apiParams.search_language_filter = args.search_language_filter;
		if (args.language_preference !== undefined) apiParams.language_preference = args.language_preference;
		if (args.disable_search !== undefined) apiParams.disable_search = args.disable_search;
		if (args.enable_search_classifier !== undefined) apiParams.enable_search_classifier = args.enable_search_classifier;
		if (args.return_images !== undefined) apiParams.return_images = args.return_images;
		if (args.return_related_questions !== undefined) apiParams.return_related_questions = args.return_related_questions;
		if (args.image_domain_filter !== undefined) apiParams.image_domain_filter = args.image_domain_filter;
		if (args.image_format_filter !== undefined) apiParams.image_format_filter = args.image_format_filter;
		if (args.stream_mode !== undefined) apiParams.stream_mode = args.stream_mode;

		if (args.stream) apiParams.stream = true;

		return apiParams;
	}
}
