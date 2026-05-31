/**
 * MCP tool schemas for the Perplexity server
 */

import { VALID_MODELS, VALID_EMBEDDING_MODELS, VALID_AGENT_PRESETS } from "./types.js";

export const TOOL_SCHEMAS = [
	{
		name: "search",
		description: "Web search via Perplexity AI with automatic model selection. Returns an AI-synthesized answer with cited sources. The search uses only the query text (not conversation history). Best for: current events, factual research, technical documentation, comparative analysis.",
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
					description: "Controls how much web context is retrieved. 'low' (default): fastest and cheapest. 'medium': balanced. 'high': maximum depth, higher cost.",
				},
				search_type: {
					type: "string",
					enum: ["fast", "pro", "auto"],
					description: "Search engine tier (nested in web_search_options). 'fast': quick single-pass. 'pro': multi-step Pro Search. 'auto': let Perplexity decide.",
				},
				reasoning_effort: {
					type: "string",
					enum: ["minimal", "low", "medium", "high"],
					description: "Controls reasoning depth. Only meaningful for sonar-deep-research. 'minimal'/'low': faster, simpler. 'medium': balanced. 'high': most thorough, higher token usage.",
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
				search_after_date: {
					type: "string",
					description: "Only include sources published after this date. Format: MM/DD/YYYY (e.g. '3/1/2025').",
				},
				search_before_date: {
					type: "string",
					description: "Only include sources published before this date. Format: MM/DD/YYYY.",
				},
				last_updated_after: {
					type: "string",
					description: "Only include sources last updated after this date. Format: MM/DD/YYYY.",
				},
				last_updated_before: {
					type: "string",
					description: "Only include sources last updated before this date. Format: MM/DD/YYYY.",
				},
				search_language_filter: {
					type: "array",
					items: { type: "string" },
					description: "Restrict sources to these languages. ISO 639-1 codes (e.g. ['en','de']).",
				},
				language_preference: {
					type: "string",
					description: "Preferred response language. ISO 639-1 code (e.g. 'en', 'es').",
				},
				disable_search: {
					type: "boolean",
					description: "When true, the model answers from its training data only — no web search is performed.",
				},
				enable_search_classifier: {
					type: "boolean",
					description: "When true, a classifier decides whether a web search is actually needed for the query (Pro Search behavior).",
				},
				stream_mode: {
					type: "string",
					enum: ["full", "concise"],
					description: "Streaming event format for Pro Search. 'full' (default): reasoning suppressed, metadata inline. 'concise': reasoning events emitted separately.",
				},
				return_images: {
					type: "boolean",
					description: "Include image results. When true, an '## Images' section of URLs is appended to the output.",
				},
				return_related_questions: {
					type: "boolean",
					description: "Generate follow-up question suggestions, appended as a '## Related Questions' section.",
				},
				image_domain_filter: {
					type: "array",
					items: { type: "string" },
					description: "Restrict returned images to these domains (requires return_images).",
				},
				image_format_filter: {
					type: "array",
					items: { type: "string" },
					description: "Restrict returned images to these formats, e.g. ['png','jpg'] (requires return_images).",
				},
				country: {
					type: "string",
					description: "Localize search to a country. ISO 3166-1 alpha-2 code (e.g. 'US', 'GB'). Sent as web_search_options.user_location.country.",
				},
				latitude: {
					type: "number",
					description: "Approximate user latitude for localized results (sent with country in user_location).",
				},
				longitude: {
					type: "number",
					description: "Approximate user longitude for localized results (sent with country in user_location).",
				},
				show_cost: {
					type: "boolean",
					description: "Append a one-line request-cost footer from usage.cost when the API returns it (default: false).",
				},
			},
			required: ["query"],
		},
	},
	{
		name: "raw_search",
		description: "Direct web search returning ranked results without LLM synthesis. Faster and cheaper than 'search' — use when you need source URLs, titles, and snippets without an AI-generated response. Good for: URL discovery, fact-checking pipelines, building source lists. Supports multi-query (pass an array of queries in one request).",
		inputSchema: {
			type: "object",
			properties: {
				query: {
					oneOf: [
						{ type: "string" },
						{ type: "array", items: { type: "string" } },
					],
					description: "Search query string, or an array of query strings to run in a single request.",
				},
				max_results: {
					type: "number",
					description: "Number of results to return (1-20, default: 10).",
				},
				max_tokens: {
					type: "number",
					description: "Total token budget across all returned page contents.",
				},
				max_tokens_per_page: {
					type: "number",
					description: "Per-result token cap on extracted page content.",
				},
				search_mode: {
					type: "string",
					enum: ["web", "academic", "sec"],
					description: "'web' (default): standard web search. 'academic': peer-reviewed sources. 'sec': SEC filings.",
				},
				search_type: {
					type: "string",
					enum: ["web", "people"],
					description: "'web' (default): general web results. 'people': People Search routing for professional/person lookups.",
				},
				recency: {
					type: "string",
					enum: ["hour", "day", "week", "month", "year"],
					description: "Restrict results to a time window.",
				},
				search_after_date: {
					type: "string",
					description: "Include results published after this date. Format: MM/DD/YYYY.",
				},
				search_before_date: {
					type: "string",
					description: "Include results published before this date. Format: MM/DD/YYYY.",
				},
				last_updated_after: {
					type: "string",
					description: "Include results last updated after this date. Format: MM/DD/YYYY.",
				},
				last_updated_before: {
					type: "string",
					description: "Include results last updated before this date. Format: MM/DD/YYYY.",
				},
				search_language_filter: {
					type: "array",
					items: { type: "string" },
					description: "Restrict results to these languages. ISO 639-1 codes.",
				},
				country: {
					type: "string",
					description: "Localize results to a country. ISO 3166-1 alpha-2 code (e.g. 'US', 'GB', 'DE').",
				},
			},
			required: ["query"],
		},
	},
	{
		name: "async_research",
		description: "Submit and poll long-running asynchronous deep-research jobs (sonar-deep-research). Use this instead of 'search' when a query needs exhaustive research that may exceed a synchronous timeout. Submit returns a request_id; poll with action 'status' until COMPLETED. Jobs expire 7 days after creation.",
		inputSchema: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: ["submit", "status", "list"],
					description: "'submit': start a new job (requires query). 'status': poll a job (requires request_id). 'list': list recent jobs.",
				},
				query: {
					type: "string",
					description: "Research question. Required when action is 'submit'.",
				},
				request_id: {
					type: "string",
					description: "Job id returned by a prior submit. Required when action is 'status'.",
				},
				model: {
					type: "string",
					enum: VALID_MODELS,
					description: "Model for the job (default: sonar-deep-research).",
				},
				reasoning_effort: {
					type: "string",
					enum: ["minimal", "low", "medium", "high"],
					description: "Reasoning depth for sonar-deep-research.",
				},
				search_mode: {
					type: "string",
					enum: ["web", "academic", "sec"],
					description: "Search domain for the job.",
				},
				strip_thinking: {
					type: "boolean",
					description: "Strip <think> blocks from the completed result (default: false).",
				},
			},
			required: ["action"],
		},
	},
	{
		name: "agent",
		description: "Perplexity Agent API: an agentic loop that can call built-in tools (web_search, fetch_url) and run third-party models. Use for multi-step tasks that need tool use or a specific external model. Distinct from 'search' (single grounded answer).",
		inputSchema: {
			type: "object",
			properties: {
				input: {
					type: "string",
					description: "The task or question for the agent.",
				},
				model: {
					type: "string",
					description: "Provider-qualified model, e.g. 'openai/gpt-4.1' or 'anthropic/claude-sonnet-4-6'. Omit to use a preset.",
				},
				models: {
					type: "array",
					items: { type: "string" },
					description: "Fallback chain of provider-qualified models; takes precedence over 'model'.",
				},
				preset: {
					type: "string",
					enum: VALID_AGENT_PRESETS,
					description: "Named preset instead of a specific model: 'fast-search', 'pro-search', or 'deep-research'.",
				},
				instructions: {
					type: "string",
					description: "System prompt / instructions for the agent.",
				},
				max_steps: {
					type: "number",
					description: "Maximum agentic reasoning/tool steps (1-10).",
				},
				max_output_tokens: {
					type: "number",
					description: "Maximum output tokens.",
				},
				language_preference: {
					type: "string",
					description: "Preferred response language. ISO 639-1 code.",
				},
				tools: {
					type: "array",
					items: { type: "string", enum: ["web_search", "fetch_url"] },
					description: "Built-in tools the agent may use: 'web_search', 'fetch_url'.",
				},
			},
			required: ["input"],
		},
	},
	{
		name: "embeddings",
		description: "Generate text embeddings via the Perplexity Embeddings API. Returns a compact summary (model, vector count, token usage) by default; pass full:true to include the raw base64-encoded vectors.",
		inputSchema: {
			type: "object",
			properties: {
				input: {
					oneOf: [
						{ type: "string" },
						{ type: "array", items: { type: "string" } },
					],
					description: "Text to embed, or an array of texts (max 512 per request).",
				},
				model: {
					type: "string",
					enum: VALID_EMBEDDING_MODELS,
					description: "Embedding model (default: pplx-embed-v1-0.6b).",
				},
				dimensions: {
					type: "number",
					description: "Output dimensions (Matryoshka). 128-1024 for 0.6b, 128-2560 for 4b. Defaults to full dimensions.",
				},
				full: {
					type: "boolean",
					description: "Include the raw base64-encoded embedding vectors in the output (default: false).",
				},
			},
			required: ["input"],
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
