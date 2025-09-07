/**
 * MCP tool schemas for the Perplexity server
 */

import { VALID_MODELS } from "./types.js";

export const TOOL_SCHEMAS = [
	{
		name: "search",
		description: "Search the web using Perplexity AI",
		inputSchema: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description: "The search query",
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
		description: "Add a domain to allow or block in search results (max 20 domains total)",
		inputSchema: {
			type: "object",
			properties: {
				domain: {
					type: "string",
					description: "Domain name without http:// or https:// (example: wikipedia.org)",
				},
				action: {
					type: "string",
					enum: ["allow", "block"],
					description: "Whether to allow or block this domain",
				},
			},
			required: ["domain", "action"],
		},
	},
	{
		name: "recency_filter",
		description: "Set the time recency for search results",
		inputSchema: {
			type: "object",
			properties: {
				filter: {
					type: "string",
					enum: ["hour", "day", "week", "month", "none"],
					description: "Time window for search results (none to disable filtering)",
				},
			},
			required: ["filter"],
		},
	},
	{
		name: "clear_filters",
		description: "Clear all domain filters",
		inputSchema: {
			type: "object",
			properties: {},
		},
	},
	{
		name: "list_filters",
		description: "List all current domain filters",
		inputSchema: {
			type: "object",
			properties: {},
		},
	},
	{
		name: "model_info",
		description: "Get information about available models and optionally set a specific model",
		inputSchema: {
			type: "object",
			properties: {
				model: {
					type: "string",
					enum: VALID_MODELS,
					description: "Optional: Set a specific model instead of using automatic selection",
				},
			},
		},
	},
] as const;