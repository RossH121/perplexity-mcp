/**
 * MCP tool schemas for the Perplexity server
 */

import { VALID_MODELS } from "./types.js";

export const TOOL_SCHEMAS = [
	{
		name: "search",
		description: "Web search via Perplexity AI with automatic model selection. Returns cited sources with summaries. The search uses only the query text (not conversation history). Best for: current events, factual research, technical documentation, comparative analysis.",
		inputSchema: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description: "Direct search query. Be specific with 2-3 context words, use expert terminology. Good: 'Compare 2025 React vs Vue performance for enterprise apps'. Bad: 'tell me about frameworks'. Tips: Use 'site:domain.com' for specific sites, include years for recent info, add 'analyze/compare/explain' for reasoning tasks.",
				},
				stream: {
					type: "boolean",
					description: "Enable streaming responses (default: false)",
				},
				search_context_size: {
					type: "string",
					enum: ["low", "medium", "high"],
					description: "Controls how much web context is retrieved. 'low' (default): fastest and cheapest. 'medium': balanced. 'high': maximum depth, higher cost. Not available for sonar-deep-research.",
				},
				reasoning_effort: {
					type: "string",
					enum: ["minimal", "low", "medium", "high"],
					description: "Controls reasoning depth for sonar-deep-research. 'low': faster, simpler. 'medium': balanced (default). 'high': most thorough, higher token usage.",
				},
				strip_thinking: {
					type: "boolean",
					description: "Remove <think>...</think> reasoning blocks from the response. Useful with sonar-reasoning-pro and sonar-deep-research to save context window space (default: false)",
				},
				search_mode: {
					type: "string",
					enum: ["web", "academic", "sec"],
					description: "'web' (default): standard web search. 'academic': prioritizes peer-reviewed papers, journals, and academic sources. 'sec': searches SEC filings and financial documents.",
				},
			},
			required: ["query"],
		},
	},
	{
		name: "raw_search",
		description: "Direct web search returning ranked results without LLM synthesis. Faster and cheaper than 'search' — use when you need source URLs, titles, and snippets without an AI-generated response. Good for: URL discovery, fact-checking pipelines, building source lists.",
		inputSchema: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description: "Search query string",
				},
				max_results: {
					type: "number",
					description: "Number of results to return (1-20, default: 10)",
				},
				search_mode: {
					type: "string",
					enum: ["web", "academic", "sec"],
					description: "'web' (default): standard web search. 'academic': peer-reviewed sources. 'sec': SEC filings.",
				},
				recency: {
					type: "string",
					enum: ["hour", "day", "week", "month", "year"],
					description: "Restrict results to a time window",
				},
				search_after_date: {
					type: "string",
					description: "Include results published after this date. Format: MM/DD/YYYY (e.g. '3/1/2025')",
				},
				search_before_date: {
					type: "string",
					description: "Include results published before this date. Format: MM/DD/YYYY (e.g. '12/31/2025')",
				},
				country: {
					type: "string",
					description: "Localize results to a country. ISO 3166-1 alpha-2 code (e.g. 'US', 'GB', 'DE')",
				},
			},
			required: ["query"],
		},
	},
	{
		name: "domain_filter",
		description: "Configure domain filtering for search results. Use 'allow' to restrict results to trusted sources (e.g., documentation sites, academic domains) or 'block' to exclude unreliable sources. Maximum 20 domains total. Cannot mix allow and block in the same filter set — use clear_filters first to switch modes. Filters persist across searches until cleared.",
		inputSchema: {
			type: "object",
			properties: {
				domain: {
					type: "string",
					description: "Domain name without protocol. Examples: 'wikipedia.org', 'docs.python.org', 'arxiv.org'. For subdomains: 'api.example.com'",
				},
				action: {
					type: "string",
					enum: ["allow", "block"],
					description: "'allow' restricts results to this domain only (allowlist mode). 'block' excludes this domain from results (denylist mode).",
				},
			},
			required: ["domain", "action"],
		},
	},
	{
		name: "recency_filter",
		description: "Control the time window for search results. Essential for time-sensitive queries like news, updates, or recent developments. Filter persists until changed.",
		inputSchema: {
			type: "object",
			properties: {
				filter: {
					type: "string",
					enum: ["hour", "day", "week", "month", "year", "none"],
					description: "Time window: 'hour' for breaking news, 'day' for daily updates, 'week' for recent developments, 'month' for broader recent context, 'year' for the past year, 'none' to include all time periods",
				},
			},
			required: ["filter"],
		},
	},
	{
		name: "clear_filters",
		description: "Remove all domain filters (both allowed and blocked) and recency filter. Use when switching search contexts or starting fresh.",
		inputSchema: {
			type: "object",
			properties: {},
		},
	},
	{
		name: "list_filters",
		description: "Display current filter configuration including allowed domains, blocked domains, and active recency setting. Useful for debugging search behavior.",
		inputSchema: {
			type: "object",
			properties: {},
		},
	},
	{
		name: "model_info",
		description: "View available Perplexity models and their specializations, or manually override model selection. By default, models are auto-selected based on query intent (research, reasoning, general search).",
		inputSchema: {
			type: "object",
			properties: {
				model: {
					type: "string",
					enum: VALID_MODELS,
					description: "Optional: Override auto-selection. 'sonar-deep-research' for comprehensive analysis, 'sonar-reasoning-pro' for complex logic and chain-of-thought, 'sonar-pro' for general search, 'sonar' for quick lookups",
				},
			},
		},
	},
] as const;
