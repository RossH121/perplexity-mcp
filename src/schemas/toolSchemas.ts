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
			},
			required: ["query"],
		},
	},
	{
		name: "domain_filter",
		description: "Configure domain filtering for search results. Use 'allow' to prioritize trusted sources (e.g., documentation sites, academic domains) or 'block' to exclude unreliable sources. Maximum 20 domains total. Filters persist across searches until cleared.",
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
					description: "'allow' prioritizes this domain in results, 'block' excludes it completely",
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
					enum: ["hour", "day", "week", "month", "none"],
					description: "Time window: 'hour' for breaking news, 'day' for daily updates, 'week' for recent developments, 'month' for broader recent context, 'none' to include all time periods",
				},
			},
			required: ["filter"],
		},
	},
	{
		name: "clear_filters",
		description: "Remove all domain filters (both allowed and blocked). Use when switching search contexts or starting fresh. Does not affect recency filter.",
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
					description: "Optional: Override auto-selection. 'sonar-deep-research' for comprehensive analysis, 'sonar-reasoning-pro' for complex logic, 'sonar' for quick lookups",
				},
			},
		},
	},
] as const;