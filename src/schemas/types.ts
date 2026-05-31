/**
 * TypeScript interfaces and types for the Perplexity MCP server
 */

// Shared sub-types ---------------------------------------------------------

export interface UserLocation {
	latitude?: number;
	longitude?: number;
	country?: string;
}

export interface WebSearchOptions {
	search_context_size?: "low" | "medium" | "high";
	search_type?: "fast" | "pro" | "auto";
	user_location?: UserLocation;
}

export interface ResponseImage {
	image_url?: string;
	url?: string;
	origin_url?: string;
	height?: number;
	width?: number;
}

export interface SearchResultItem {
	title: string;
	url: string;
	date?: string;
	last_updated?: string;
	snippet?: string;
	source?: string;
}

export interface UsageCost {
	input_tokens_cost?: number;
	output_tokens_cost?: number;
	request_cost?: number;
	reasoning_tokens_cost?: number;
	citation_tokens_cost?: number;
	search_queries_cost?: number;
	total_cost?: number;
}

export interface Usage {
	prompt_tokens?: number;
	completion_tokens?: number;
	total_tokens?: number;
	cost?: UsageCost;
}

// Perplexity API response types -------------------------------------------

export interface SearchResponse {
	choices: [
		{
			message: {
				content: string;
			};
		},
	];
	search_results?: SearchResultItem[];
	images?: ResponseImage[];
	related_questions?: string[];
	usage?: Usage;
}

export interface StreamChunk {
	choices: [
		{
			delta: {
				content?: string;
			};
		},
	];
	search_results?: SearchResultItem[];
	images?: ResponseImage[];
	related_questions?: string[];
	usage?: Usage;
}

// Model selection types
export interface ModelSelectionCriteria {
	keywords: string[];
	description: string;
}

export interface ModelSelection {
	model: string;
	description: string;
	score: number;
}

// Filter management types
export interface DomainFilters {
	allowedDomains: string[];
	blockedDomains: string[];
}

// Tool argument types ------------------------------------------------------

export interface SearchArgs {
	query: string;
	stream?: boolean;
	search_context_size?: "low" | "medium" | "high";
	search_type?: "fast" | "pro" | "auto";
	reasoning_effort?: "minimal" | "low" | "medium" | "high";
	strip_thinking?: boolean;
	search_mode?: "web" | "academic" | "sec";
	// Date filters (MM/DD/YYYY)
	search_after_date?: string;
	search_before_date?: string;
	last_updated_after?: string;
	last_updated_before?: string;
	// Language
	search_language_filter?: string[];
	language_preference?: string;
	// Search behavior
	disable_search?: boolean;
	enable_search_classifier?: boolean;
	stream_mode?: "full" | "concise";
	// Image / media
	return_images?: boolean;
	return_related_questions?: boolean;
	image_domain_filter?: string[];
	image_format_filter?: string[];
	// Location
	country?: string;
	latitude?: number;
	longitude?: number;
	// Cost reporting
	show_cost?: boolean;
}

export interface RawSearchArgs {
	query: string | string[];
	max_results?: number;
	max_tokens?: number;
	max_tokens_per_page?: number;
	search_mode?: "web" | "academic" | "sec";
	search_type?: "web" | "people";
	recency?: string;
	search_after_date?: string;
	search_before_date?: string;
	last_updated_after?: string;
	last_updated_before?: string;
	search_language_filter?: string[];
	country?: string;
}

export interface AsyncResearchArgs {
	action: "submit" | "status" | "list";
	query?: string;
	request_id?: string;
	model?: string;
	reasoning_effort?: "minimal" | "low" | "medium" | "high";
	search_mode?: "web" | "academic" | "sec";
	strip_thinking?: boolean;
}

export interface AgentArgs {
	input: string;
	model?: string;
	models?: string[];
	preset?: string;
	instructions?: string;
	max_steps?: number;
	max_output_tokens?: number;
	language_preference?: string;
	tools?: Array<"web_search" | "fetch_url">;
}

export interface EmbeddingsArgs {
	input: string | string[];
	model?: "pplx-embed-v1-0.6b" | "pplx-embed-v1-4b";
	dimensions?: number;
	full?: boolean;
}

export interface DomainArgs {
	domain: string;
	action: "allow" | "block";
}

export interface RecencyArgs {
	filter: string;
}

export interface ModelArgs {
	model?: string;
}

// MCP request types
export interface RequestParams {
	name: string;
	arguments?: Record<string, unknown>;
	_meta?: unknown;
}

export interface McpRequest {
	params: RequestParams;
	method?: string;
}

// API parameter types ------------------------------------------------------
// Mirrors the SDK CompletionCreateParams body (snake_case).
export interface ApiParams {
	model: string;
	messages: {
		role: string;
		content: string;
	}[];
	search_domain_filter?: string[];
	search_recency_filter?: string;
	search_mode?: "web" | "academic" | "sec";
	search_after_date_filter?: string;
	search_before_date_filter?: string;
	last_updated_after_filter?: string;
	last_updated_before_filter?: string;
	search_language_filter?: string[];
	language_preference?: string;
	disable_search?: boolean;
	enable_search_classifier?: boolean;
	reasoning_effort?: "minimal" | "low" | "medium" | "high";
	return_images?: boolean;
	return_related_questions?: boolean;
	image_domain_filter?: string[];
	image_format_filter?: string[];
	stream_mode?: "full" | "concise";
	web_search_options?: WebSearchOptions;
	stream?: boolean;
}

// Options object consumed by PerplexityApiService.createApiParams()
export interface CreateApiParamsOptions {
	model: string;
	query: string;
	domainFilters?: string[];
	recencyFilter?: string;
	args: SearchArgs;
	systemPrompt?: string;
}

// Raw search result type
export interface RawSearchResult {
	title: string;
	url: string;
	snippet: string;
	date?: string;
	last_updated?: string;
}

// Valid models and filters
export const VALID_MODELS = [
	"sonar-deep-research",
	"sonar-reasoning-pro",
	"sonar-pro",
	"sonar",
] as const;

export const VALID_RECENCY_FILTERS = [
	"hour",
	"day",
	"week",
	"month",
	"year",
	"none",
] as const;

export const VALID_EMBEDDING_MODELS = [
	"pplx-embed-v1-0.6b",
	"pplx-embed-v1-4b",
] as const;

export const VALID_AGENT_PRESETS = [
	"fast-search",
	"pro-search",
	"deep-research",
] as const;

export type ValidModel = typeof VALID_MODELS[number];
export type ValidRecencyFilter = typeof VALID_RECENCY_FILTERS[number];
export type ValidEmbeddingModel = typeof VALID_EMBEDDING_MODELS[number];
