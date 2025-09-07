/**
 * Application constants for the Perplexity MCP server
 */

import { ModelSelectionCriteria } from "../schemas/types.js";

// Model selection criteria based on user intent
export const MODEL_SELECTION_MAP: Record<string, ModelSelectionCriteria> = {
	"sonar-deep-research": {
		keywords: [
			"deep research",
			"comprehensive",
			"thorough",
			"detailed analysis",
			"expert",
			"in-depth",
		],
		description:
			"specialized for extensive research and expert-level analysis across domains",
	},
	"sonar-reasoning-pro": {
		keywords: [
			"reasoning",
			"logic",
			"solve",
			"mathematical",
			"technical",
			"complex problem",
			"figure out",
		],
		description:
			"optimized for advanced logical reasoning and complex problem-solving",
	},
	"sonar-reasoning": {
		keywords: ["reason", "think", "analyze", "deduce", "evaluate"],
		description: "designed for reasoning tasks with balanced performance",
	},
	"sonar-pro": {
		keywords: [
			"search",
			"find",
			"lookup",
			"information",
			"facts",
			"details",
			"latest",
		],
		description:
			"general-purpose model with excellent search capabilities and citation density",
	},
	sonar: {
		keywords: ["quick", "simple", "basic", "brief", "short"],
		description: "fast and efficient for straightforward queries",
	},
};

// API Configuration
export const API_CONFIG = {
	BASE_URL: "https://api.perplexity.ai",
	TIMEOUT: 30000,
	MAX_DOMAINS: 20,
} as const;

// Server Configuration
export const SERVER_CONFIG = {
	name: "perplexity-search-server",
	version: "0.1.0",
} as const;