/**
 * TypeScript interfaces and types for the Perplexity MCP server
 */

// Perplexity API response types
export interface SearchResponse {
	choices: [
		{
			message: {
				content: string;
			};
		},
	];
}

export interface StreamChunk {
	choices: [
		{
			delta: {
				content?: string;
			};
		},
	];
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

// Tool argument types
export interface SearchArgs {
	query: string;
	stream?: boolean;
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

// API parameter types
export interface ApiParams {
	model: string;
	messages: {
		role: string;
		content: string;
	}[];
	search_domain_filter?: string[];
	search_recency_filter?: string;
	stream?: boolean;
}

// Valid models and filters
export const VALID_MODELS = [
	"sonar-deep-research",
	"sonar-reasoning-pro",
	"sonar-reasoning",
	"sonar-pro",
	"sonar",
] as const;

export const VALID_RECENCY_FILTERS = [
	"hour",
	"day", 
	"week",
	"month",
	"none"
] as const;

export type ValidModel = typeof VALID_MODELS[number];
export type ValidRecencyFilter = typeof VALID_RECENCY_FILTERS[number];