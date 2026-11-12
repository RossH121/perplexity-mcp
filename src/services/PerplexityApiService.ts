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
	ContextualizedEmbeddingsArgs,
	ModelListResponse,
	HandlerContext,
	SearchResultItem,
	ResponseImage,
} from "../schemas/types.js";
import { API_CONFIG, DEFAULT_EMBEDDING_MODEL, DEFAULT_CONTEXTUALIZED_EMBEDDING_MODEL } from "../config/constants.js";
import { EnvironmentConfig } from "../config/environment.js";
import { DEFAULT_AGENT_EFFORT } from "../schemas/types.js";
import { buildAgentInput, buildWebSearchTool } from "../utils/agentRequest.js";
import { DecisionsArgs } from "../schemas/types.js";
import { DEFAULT_DECISION_MODEL } from "../config/constants.js";

/**
 * SDK per-request options built from a HandlerContext. Every SDK call in this
 * service MUST pass this as its options argument so MCP cancellation aborts
 * the in-flight HTTP request. Placement differs per method (usually the 2nd
 * arg; 3rd for methods with a query-params arg such as async get,
 * responses.retrieve and responses.files.content).
 */
function requestOptions(ctx: HandlerContext = {}): { signal?: AbortSignal } {
	return ctx.signal ? { signal: ctx.signal } : {};
}

// Identifies this MCP server to Perplexity; only sent to the public API host.
const INTEGRATION_HEADERS = { "X-Pplx-Integration": "perplexity-mcp" };

function isPerplexityApiHost(baseURL: string): boolean {
	try {
		return new URL(baseURL).hostname === "api.perplexity.ai";
	} catch {
		return false;
	}
}

export class PerplexityApiService {
	private client: Perplexity;

	constructor(private config: EnvironmentConfig) {
		// Same resolution as the SDK: PERPLEXITY_BASE_URL, else the public API.
		const baseURL = process.env.PERPLEXITY_BASE_URL?.trim() || API_CONFIG.BASE_URL;
		this.client = new Perplexity({
			apiKey: this.config.apiKey,
			timeout: API_CONFIG.TIMEOUT,
			defaultHeaders: isPerplexityApiHost(baseURL) ? INTEGRATION_HEADERS : undefined,
		});
	}

	/**
	 * Performs a chat-based search using the Perplexity API
	 */
	async search(apiParams: ApiParams, ctx: HandlerContext = {}): Promise<SearchResponse> {
		const { stream, ...params } = apiParams;
		const response = await (this.client.chat.completions.create as Function)({
			...params,
			stream: false,
		}, requestOptions(ctx));
		return response as SearchResponse;
	}

	/**
	 * Handles streaming search responses
	 */
	async searchStream(apiParams: ApiParams, ctx: HandlerContext = {}): Promise<{
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
		}, requestOptions(ctx));

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
	async rawSearch(args: RawSearchArgs, ctx: HandlerContext = {}): Promise<RawSearchResult[]> {
		const params: Record<string, unknown> = {
			query: args.query,
		};

		if (args.max_results !== undefined) params["max_results"] = args.max_results;
		if (args.max_tokens !== undefined) params["max_tokens"] = args.max_tokens;
		if (args.max_tokens_per_page !== undefined) params["max_tokens_per_page"] = args.max_tokens_per_page;
		// Do NOT send search_mode here: /search returns 400 "search_mode is not
		// supported" (verified live 2026-08-24). It is Sonar-only.
		if (args.search_context_size !== undefined) params["search_context_size"] = args.search_context_size;
		if (args.search_type !== undefined) params["search_type"] = args.search_type;
		if (args.recency !== undefined) params["search_recency_filter"] = args.recency;
		if (args.search_after_date !== undefined) params["search_after_date_filter"] = args.search_after_date;
		if (args.search_before_date !== undefined) params["search_before_date_filter"] = args.search_before_date;
		if (args.last_updated_after !== undefined) params["last_updated_after_filter"] = args.last_updated_after;
		if (args.last_updated_before !== undefined) params["last_updated_before_filter"] = args.last_updated_before;
		if (args.search_language_filter !== undefined) params["search_language_filter"] = args.search_language_filter;
		if (args.search_domain_filter !== undefined) params["search_domain_filter"] = args.search_domain_filter;
		if (args.country !== undefined) params["country"] = args.country;

		const response = await (this.client.search.create as Function)(params, requestOptions(ctx));
		return (response.results ?? []) as RawSearchResult[];
	}

	/**
	 * Submits an asynchronous deep-research job (fire-and-poll). 7-day TTL.
	 */
	async submitAsyncResearch(request: ApiParams, ctx: HandlerContext = {}): Promise<any> {
		const { stream, ...req } = request;
		return (this.client as any).async.chat.completions.create({ request: req }, requestOptions(ctx));
	}

	/**
	 * Polls a single async job by request id.
	 */
	async getAsyncResearch(requestId: string, ctx: HandlerContext = {}): Promise<any> {
		return (this.client as any).async.chat.completions.get(requestId, undefined, requestOptions(ctx));
	}

	/**
	 * Lists async jobs for the authenticated account.
	 */
	async listAsyncResearch(ctx: HandlerContext = {}): Promise<any> {
		return (this.client as any).async.chat.completions.list(requestOptions(ctx));
	}

	/**
	 * Agent API call with a prebuilt body (see services/agentSearchRequest.ts).
	 * Backs `search` on the agent backend and `async_research` submit (with
	 * background:true). Separate from agentRespond(), which maps agent-tool args.
	 */
	async agentSearch(body: Record<string, unknown>, ctx: HandlerContext = {}): Promise<any> {
		return (this.client.responses.create as Function)({ ...body, stream: false }, requestOptions(ctx));
	}

	/**
	 * Agent API call via the OpenAI-compatible responses surface.
	 */
	async agentRespond(args: AgentArgs, ctx: HandlerContext = {}): Promise<any> {
		// Bare string input by default; an item array when images/files are
		// attached or approval responses are being sent (see buildAgentInput).
		const input = buildAgentInput(args.input, args.images, args.files, args.approval_responses);
		const body: Record<string, unknown> = { input };
		if (args.model !== undefined) body["model"] = args.model;
		if (args.models !== undefined) body["models"] = args.models;
		// `preset` is the deprecated alias of `effort`; send only `effort`, with
		// `effort` winning when both are supplied (same precedence as the API).
		const effort = args.effort ?? args.preset;
		if (effort !== undefined) body["effort"] = effort;
		if (args.profile !== undefined) {
			const profile: Record<string, unknown> = { type: "custom", id: args.profile.id };
			if (args.profile.version !== undefined) profile["version"] = args.profile.version;
			body["profile"] = profile;
		}
		if (args.instructions !== undefined) body["instructions"] = args.instructions;
		if (args.max_steps !== undefined) body["max_steps"] = args.max_steps;
		if (args.max_output_tokens !== undefined) body["max_output_tokens"] = args.max_output_tokens;
		if (args.language_preference !== undefined) body["language_preference"] = args.language_preference;
		if (args.tool_choice !== undefined) body["tool_choice"] = args.tool_choice;
		// Built-in tools (flat string enum) and remote MCP servers (compound
		// objects) both land in the same `tools` array the API expects.
		// web_search_options is merged into the web_search entry, which it
		// implicitly enables.
		const toolEntries: Array<Record<string, unknown>> = [];
		const builtins = [...(args.tools ?? [])];
		if (args.web_search_options !== undefined && !builtins.includes("web_search")) {
			builtins.unshift("web_search");
		}
		for (const t of builtins) {
			toolEntries.push(
				t === "web_search" && args.web_search_options !== undefined
					? buildWebSearchTool(args.web_search_options)
					: { type: t }
			);
		}
		if (args.mcp_servers !== undefined) {
			for (const s of args.mcp_servers) {
				const entry: Record<string, unknown> = {
					type: "mcp",
					server_label: s.server_label,
					server_url: s.server_url,
				};
				if (s.authorization !== undefined) entry["authorization"] = s.authorization;
				if (s.headers !== undefined) entry["headers"] = s.headers;
				if (s.allowed_tools !== undefined) entry["allowed_tools"] = s.allowed_tools;
				if (s.defer_loading !== undefined) entry["defer_loading"] = s.defer_loading;
				if (s.require_approval !== undefined) entry["require_approval"] = s.require_approval;
				toolEntries.push(entry);
			}
		}
		if (toolEntries.length > 0) body["tools"] = toolEntries;
		if (args.skills !== undefined) {
			body["skills"] = args.skills.map((s) => {
				if (s.type === "builtin") return { type: "builtin", name: s.name };
				if (s.type === "custom") {
					return s.version !== undefined
						? { type: "custom", id: s.id, version: s.version }
						: { type: "custom", id: s.id };
				}
				return {
					type: "inline",
					name: s.name,
					description: s.description,
					instructions: s.instructions,
				};
			});
		}
		if (args.previous_response_id !== undefined) body["previous_response_id"] = args.previous_response_id;
		if (args.store !== undefined) body["store"] = args.store;
		if (args.temperature !== undefined) body["temperature"] = args.temperature;
		if (args.top_p !== undefined) body["top_p"] = args.top_p;
		if (args.service_tier !== undefined) body["service_tier"] = args.service_tier;
		if (args.prompt_cache_key !== undefined) body["prompt_cache_key"] = args.prompt_cache_key;
		if (args.reasoning_effort !== undefined) body["reasoning"] = { effort: args.reasoning_effort };
		if (args.response_format !== undefined) {
			// The Agent API requires json_schema.name; inject a default when omitted.
			const rf = args.response_format;
			body["response_format"] = rf.json_schema.name
				? rf
				: { ...rf, json_schema: { ...rf.json_schema, name: "response" } };
		}
		if (args.background !== undefined) body["background"] = args.background;
		// The Agent API requires one of model/models/effort/profile. When the
		// caller supplies none, default to the balanced "low" effort so a bare
		// agent({ input }) call succeeds instead of returning a 400. Never inject
		// alongside a profile: the API rejects profile + effort.
		if (!args.model && !args.models?.length && effort === undefined && args.profile === undefined) {
			body["effort"] = DEFAULT_AGENT_EFFORT;
		}
		body["stream"] = false;
		return (this.client.responses.create as Function)(body, requestOptions(ctx));
	}

	/**
	 * Retrieves a previously-submitted agent response by id (for background runs).
	 */
	async getAgentResponse(responseId: string, ctx: HandlerContext = {}): Promise<any> {
		return (this.client.responses.retrieve as Function)(responseId, undefined, requestOptions(ctx));
	}

	/**
	 * Requests cancellation of an in-progress (typically background) agent run.
	 * Returns { response_id, status: "cancelling" }, cancellation is async on
	 * Perplexity's side; poll with getAgentResponse to see the final status.
	 */
	async cancelAgentResponse(responseId: string, ctx: HandlerContext = {}): Promise<any> {
		return (this.client.responses.cancel as Function)(responseId, requestOptions(ctx));
	}

	/**
	 * Lists files a sandbox tool call produced during an agent run.
	 */
	async listAgentFiles(responseId: string, ctx: HandlerContext = {}): Promise<any> {
		return (this.client.responses.files.list as Function)(responseId, requestOptions(ctx));
	}

	/**
	 * Downloads a single sandbox-produced file's binary content.
	 * The SDK returns a raw fetch Response (options.__binaryResponse); this
	 * reads it into a Buffer and pulls content-type/filename off the headers.
	 */
	async getAgentFileContent(
		fileId: string,
		responseId: string,
		ctx: HandlerContext = {}
	): Promise<{ buffer: Buffer; contentType: string; filename?: string }> {
		const resp: any = await (this.client.responses.files.content as Function)(fileId, {
			response_id: responseId,
		}, requestOptions(ctx));
		const arrayBuffer = await resp.arrayBuffer();
		const buffer = Buffer.from(arrayBuffer);
		const contentType = resp.headers?.get?.("content-type") ?? "application/octet-stream";
		const disposition: string = resp.headers?.get?.("content-disposition") ?? "";
		const filenameMatch = disposition.match(/filename\*?=(?:UTF-8''|")?([^";]+)"?/i);
		return { buffer, contentType, filename: filenameMatch?.[1] };
	}

	/**
	 * Lists the models available to the account (GET /v1/models) via the
	 * typed client.models.list() resource (SDK 0.39+).
	 */
	async listModels(ctx: HandlerContext = {}): Promise<ModelListResponse> {
		return this.client.models.list(requestOptions(ctx));
	}

	/**
	 * Creates embeddings for one or more input strings.
	 */
	async createEmbeddings(args: EmbeddingsArgs, ctx: HandlerContext = {}): Promise<any> {
		const body: Record<string, unknown> = {
			input: args.input,
			model: args.model ?? DEFAULT_EMBEDDING_MODEL,
		};
		if (args.dimensions !== undefined) body["dimensions"] = args.dimensions;
		if (args.encoding_format !== undefined) body["encoding_format"] = args.encoding_format;
		return (this.client.embeddings.create as Function)(body, requestOptions(ctx));
	}

	/**
	 * Creates contextualized (document-chunk-aware) embeddings. Chunks in the
	 * same inner array share document-level context. Distinct client resource
	 * from plain embeddings (client.contextualizedEmbeddings, not client.embeddings).
	 */
	async createContextualizedEmbeddings(args: ContextualizedEmbeddingsArgs, ctx: HandlerContext = {}): Promise<any> {
		const body: Record<string, unknown> = {
			input: args.input,
			model: args.model ?? DEFAULT_CONTEXTUALIZED_EMBEDDING_MODEL,
		};
		if (args.dimensions !== undefined) body["dimensions"] = args.dimensions;
		if (args.encoding_format !== undefined) body["encoding_format"] = args.encoding_format;
		return (this.client as any).contextualizedEmbeddings.create(body, requestOptions(ctx));
	}

	/**
	 * Decisions API (POST /v1/decisions) via client.decisions.create. The SDK's
	 * DecisionsRequestInput lacks `mode` and `max_staleness`; the SDK forwards
	 * the body as-is, so they are passed through (verified live 2026-11-12).
	 * The API 400s on any unknown top-level field, so only set fields are sent.
	 */
	async createDecision(args: DecisionsArgs, ctx: HandlerContext = {}): Promise<any> {
		const body: Record<string, unknown> = {
			model: args.model ?? DEFAULT_DECISION_MODEL,
			state: args.state,
			questions: args.questions,
		};
		if (args.mode !== undefined) body["mode"] = args.mode;
		if (args.max_staleness !== undefined) body["max_staleness"] = args.max_staleness;
		return (this.client as any).decisions.create(body, requestOptions(ctx));
	}

	/** Lists the project's custom (managed) skills: GET /v1/skills. */
	async listSkills(args: { limit?: number; page_token?: string }, ctx: HandlerContext = {}): Promise<any> {
		const params: Record<string, unknown> = {};
		if (args.limit !== undefined) params["limit"] = args.limit;
		if (args.page_token !== undefined) params["page_token"] = args.page_token;
		return (this.client as any).skills.list(params, requestOptions(ctx));
	}

	/** Gets one custom skill (optionally a specific revision): GET /v1/skills/{id}. */
	async getSkill(skillId: string, revision: string | undefined, ctx: HandlerContext = {}): Promise<any> {
		const params = revision !== undefined ? { revision } : undefined;
		return (this.client as any).skills.retrieve(skillId, params, requestOptions(ctx));
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
		if (args.image_results_enhanced_relevance !== undefined) {
			webSearchOptions.image_results_enhanced_relevance = args.image_results_enhanced_relevance;
		}
		if (
			args.country !== undefined ||
			args.latitude !== undefined ||
			args.longitude !== undefined ||
			args.city !== undefined ||
			args.region !== undefined
		) {
			webSearchOptions.user_location = {
				...(args.latitude !== undefined ? { latitude: args.latitude } : {}),
				...(args.longitude !== undefined ? { longitude: args.longitude } : {}),
				...(args.country !== undefined ? { country: args.country } : {}),
				...(args.city !== undefined ? { city: args.city } : {}),
				...(args.region !== undefined ? { region: args.region } : {}),
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
		if (args.stop !== undefined) apiParams.stop = args.stop;
		if (args.temperature !== undefined) apiParams.temperature = args.temperature;
		if (args.top_p !== undefined) apiParams.top_p = args.top_p;
		if (args.max_tokens !== undefined) apiParams.max_tokens = args.max_tokens;
		if (args.response_format !== undefined) apiParams.response_format = args.response_format;

		if (args.stream) apiParams.stream = true;

		return apiParams;
	}
}
