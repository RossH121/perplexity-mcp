/**
 * Application constants for the Perplexity MCP server
 */

import { createRequire } from "node:module";
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
			"reason",
			"think",
			"analyze",
			"deduce",
			"evaluate",
		],
		description:
			"optimized for advanced logical reasoning, chain-of-thought, and complex problem-solving",
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

// Sonar model -> Agent API effort level, per the official Sonar migration
// how-to (docs.perplexity.ai/docs/agent-api/migrate-from-sonar/how-to, checked
// 2026-11-12). Sonar Chat Completions reached end of support on 2026-09-27.
export const SONAR_TO_AGENT_EFFORT: Record<string, string> = {
	sonar: "fast",
	"sonar-pro": "fast",
	"sonar-reasoning-pro": "low",
	"sonar-deep-research": "high",
};

// Model used by the agent-backed `search` when disable_search is true: a direct
// model request carries no default tools, so it really skips search (an effort
// level always pre-searches, even with tools:[] or max_tool_calls:0; verified
// live 2026-11-12).
export const AGENT_NO_SEARCH_MODEL = "perplexity/sonar";

// Domain allowlist that stands in for Sonar's search_mode:"academic" on the
// agent backend (the Agent API has no academic mode). Max 20 (API limit).
export const ACADEMIC_DOMAINS = [
	"arxiv.org",
	"pubmed.ncbi.nlm.nih.gov",
	"ncbi.nlm.nih.gov",
	"semanticscholar.org",
	"nature.com",
	"science.org",
	"sciencedirect.com",
	"springer.com",
	"wiley.com",
	"tandfonline.com",
	"ieee.org",
	"acm.org",
	"jstor.org",
	"plos.org",
	"pnas.org",
	"cell.com",
	"biorxiv.org",
	"medrxiv.org",
	"researchgate.net",
	"ssrn.com",
] as const;

// Domain filter that stands in for search_mode:"sec" (alongside finance_search).
export const SEC_DOMAINS = ["sec.gov"] as const;

// Backend for `search` and `async_research` submit. "agent" (default) uses the
// Agent API; "sonar" keeps the legacy Sonar Chat Completions / async path as a
// rollback switch. Read per call so tests and operators can flip it.
export type SearchBackend = "agent" | "sonar";
export const DEFAULT_SEARCH_BACKEND: SearchBackend = "agent";
export function resolveSearchBackend(env: NodeJS.ProcessEnv = process.env): SearchBackend {
	const raw = env.PERPLEXITY_SEARCH_BACKEND?.trim().toLowerCase();
	if (raw === "sonar" || raw === "agent") return raw;
	return DEFAULT_SEARCH_BACKEND;
}

// API Configuration
export const API_CONFIG = {
	BASE_URL: "https://api.perplexity.ai",
	TIMEOUT: 300000, // 5 minutes — needed for sonar-deep-research
	MAX_DOMAINS: 20,
} as const;

// Default embedding model
export const DEFAULT_EMBEDDING_MODEL = "pplx-embed-v1-0.6b" as const;

// Default contextualized embedding model
export const DEFAULT_CONTEXTUALIZED_EMBEDDING_MODEL = "pplx-embed-context-v1-0.6b" as const;

// Default Decisions API model (alias; currently selects pplx-decider-v1.2, 27B).
export const DEFAULT_DECISION_MODEL = "pplx-decider-latest" as const;

// Server Configuration. The version is read from package.json at runtime so
// the MCP serverInfo.version and the npm package version cannot drift.
// (build/config/constants.js -> ../../package.json is the repo root.)
const packageJson = createRequire(import.meta.url)("../../package.json") as { version: string };

export const SERVER_CONFIG = {
	name: "perplexity-search-server",
	version: packageJson.version,
} as const;
