/**
 * TypeScript interfaces and types for the Perplexity MCP server
 */

// Shared sub-types ---------------------------------------------------------

export interface UserLocation {
	latitude?: number;
	longitude?: number;
	country?: string;
	city?: string;
	region?: string;
}

export interface WebSearchOptions {
	search_context_size?: "low" | "medium" | "high";
	search_type?: "fast" | "pro" | "auto";
	user_location?: UserLocation;
	image_results_enhanced_relevance?: boolean;
}

// Structured-output request format. Mirrors the SDK Shared.ResponseFormat /
// chat ResponseFormatJsonSchema shapes (both accept `{ type, json_schema }`).
export interface JsonSchemaFormat {
	// Required by the Agent API (Shared.JsonSchemaFormat); optional on chat
	// completions. agentRespond() injects a default name when omitted.
	name?: string;
	schema: Record<string, unknown>;
	description?: string;
	strict?: boolean;
}

export interface ResponseFormat {
	type: "json_schema";
	json_schema: JsonSchemaFormat;
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
	// Enhanced image relevance ranking (nested in web_search_options).
	image_results_enhanced_relevance?: boolean;
	// Location
	country?: string;
	latitude?: number;
	longitude?: number;
	city?: string;
	region?: string;
	// Per-call recency (overrides the stateful recency_filter for this request)
	recency?: "hour" | "day" | "week" | "month" | "year";
	// Per-call domain filter (overrides the stateful domain_filter for this
	// request only; [] means "no domain filter" for this call). Max 20,
	// '-' prefix excludes, all-allow or all-exclude.
	search_domain_filter?: string[];
	// Agent effort override (agent backend only): bypasses keyword routing and
	// the model_info/set_model selection. Same format as the agent tool's effort.
	effort?: string;
	// Sampling controls (top-level chat-completions params)
	stop?: string | string[];
	temperature?: number;
	top_p?: number;
	max_tokens?: number;
	// Cost reporting
	show_cost?: boolean;
	// Structured output (JSON-schema-constrained response)
	response_format?: ResponseFormat;
}

export interface RawSearchArgs {
	query: string | string[];
	max_results?: number;
	max_tokens?: number;
	max_tokens_per_page?: number;
	// NOTE: no `search_mode` here. The /search endpoint rejects it outright with
	// 400 "search_mode is not supported" (verified live 2026-08-24) even though
	// the SDK's generated ApiSearchRequestInput still lists it. It is a Sonar
	// chat-completions field only. Use search_domain_filter to narrow corpora.
	search_context_size?: "low" | "medium" | "high";
	// "fast": lower-latency tier ($1/1K vs $5/1K for web). "people": allows max_results up to 50.
	search_type?: "web" | "fast" | "people";
	recency?: string;
	search_after_date?: string;
	search_before_date?: string;
	last_updated_after?: string;
	last_updated_before?: string;
	search_language_filter?: string[];
	search_domain_filter?: string[];
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

// Split async_research tools (the combined tool's `action` is implied).
export type AsyncResearchSubmitArgs = Pick<AsyncResearchArgs, "query" | "model" | "reasoning_effort" | "search_mode">;
export type AsyncResearchStatusArgs = Pick<AsyncResearchArgs, "request_id" | "strip_thinking">;

export interface AgentArgs {
	// Required, except on an approval continuation (`approval_responses` set),
	// where it may be empty: the API accepts approval items alone, or with a
	// trailing user message (both verified live 2026-11-12).
	input: string;
	model?: string;
	models?: string[];
	// Top-level configuration bundle: "fast" | "low" | "medium" | "high" |
	// "xhigh" | "ultra", or a pinned "name@latest" / "name@<version>". A free
	// string, not an enum: the API treats it as a pattern and 400s unknown
	// names/versions itself. Distinct from `reasoning_effort` (reasoning.effort).
	effort?: string;
	// Deprecated alias of `effort` (API renamed preset→effort, Oct 2026).
	// Mapped to `effort` in agentRespond(); `effort` wins if both are set.
	preset?: string;
	// A saved, versioned configuration from the API Portal. Cannot be combined
	// with effort/preset (API 400s; we reject client-side). Suppresses the
	// default effort injection.
	profile?: AgentProfile;
	instructions?: string;
	// 1-500. Direct-model runs (model/models, no effort) default to 1 step.
	max_steps?: number;
	max_output_tokens?: number;
	language_preference?: string;
	tools?: Array<ValidAgentTool>;
	// Options merged into the `web_search` tool entry. Setting this implicitly
	// enables web_search even if `tools` omits it.
	web_search_options?: AgentWebSearchOptions;
	// "none" | "auto" | "required". The API also accepts an object form; we
	// expose only the string enum.
	tool_choice?: "none" | "auto" | "required";
	// Remote MCP servers the agent may call. Kept separate from the flat `tools`
	// string enum (rather than widening it to a union) because MCP clients handle
	// flat enums far more reliably than per-item oneOf. Mapped to
	// { type: "mcp", ... } tool entries in agentRespond().
	mcp_servers?: Array<AgentMcpServer>;
	// Decisions for mcp_approval_request items from a prior run. Requires
	// previous_response_id, and the same mcp_servers must be resent (tools are
	// not carried over from the previous response).
	approval_responses?: Array<AgentApprovalResponse>;
	// Builtin, request-scoped inline, or custom (skill_...) skills. Max 16.
	// Selecting any skill implicitly enables the sandbox tool for that request.
	skills?: Array<AgentSkill>;
	// Nested reasoning.effort on the responses surface ('xhigh'/'max' are agent-only).
	// 'max' is absent from the SDK's generated types and 'none' is absent from
	// the API reference; the live API accepts both (verified 2026-11-12).
	reasoning_effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
	// Structured output (JSON-schema-constrained response).
	response_format?: ResponseFormat;
	// When true, the job is queued; poll the returned id with agent_retrieve.
	background?: boolean;
	// OpenAI-compatible multi-turn continuation. The prior response must belong
	// to the same account and have completed.
	previous_response_id?: string;
	// OpenAI-compatible storage toggle. When false the response is hidden from
	// agent_retrieve, but can still be chained from via previous_response_id.
	store?: boolean;
	temperature?: number;
	top_p?: number;
	// auto/default (standard), flex (0.5x, best effort), priority (2x), fast
	// (alias of priority). Kept a loose string: the API accepts unsupported
	// tiers silently and the formal /agent-post list still omits the field.
	service_tier?: string;
	prompt_cache_key?: string;
	// Image URLs to attach alongside `input` as multimodal content. When set,
	// the plain string `input` is wrapped into a single user message with an
	// input_text part plus one input_image part per URL, instead of being sent
	// as a bare string. http(s) and data: URIs are both accepted.
	images?: string[];
	// Documents (PDF/DOC/DOCX/TXT/RTF) attached as input_file parts in the same
	// user message as `images`. Exactly one of file_url / file_data per entry.
	files?: Array<AgentInputFile>;
}

// One remote MCP server exposed to an agent run. Streamable HTTP only (no SSE).
export interface AgentMcpServer {
	// ^[a-zA-Z0-9_-]{1,64}$, unique within a request.
	server_label: string;
	// HTTPS Streamable HTTP endpoint.
	server_url: string;
	// Raw bearer token. Never log this, see the redaction note in agentRespond().
	authorization?: string;
	headers?: Record<string, string>;
	// Allowlist; omit to expose every tool discovered on the server.
	allowed_tools?: string[];
	// Keeps tool schemas out of the initial context until needed.
	defer_loading?: boolean;
	// "always" | "never", or per-tool filters. A gated call returns an
	// mcp_approval_request output item and does not run.
	require_approval?: AgentRequireApproval;
}

export interface AgentApprovalFilter {
	tool_names?: string[];
	read_only?: boolean;
}

export type AgentRequireApproval =
	| "always"
	| "never"
	| { always?: AgentApprovalFilter; never?: AgentApprovalFilter };

export interface AgentApprovalResponse {
	// The `id` of an mcp_approval_request output item (mcpr_...).
	approval_request_id: string;
	approve: boolean;
	// Only allowed when approve is false.
	reason?: string;
}

// A builtin skill (by name), an inline request-scoped definition, or a custom
// skill uploaded via the Skills API (by id).
export interface AgentSkill {
	type: "builtin" | "inline" | "custom";
	// builtin + inline.
	name?: string;
	// Inline only.
	description?: string;
	// Inline only. Up to 65,536 bytes.
	instructions?: string;
	// Custom only: "skill_...".
	id?: string;
	// Custom only: pinned version; omit for latest.
	version?: string;
}

export interface AgentProfile {
	type: "custom";
	// 1-128 chars, e.g. "profile_...".
	id: string;
	// A version number or "latest"; omit for latest.
	version?: string;
}

export interface AgentInputFile {
	// Public HTTPS URL. Treated as a PDF if filename is omitted.
	file_url?: string;
	// Base64 or a data: URI.
	file_data?: string;
	filename?: string;
}

// Flat MCP-facing shape for the web_search tool's options. Filter keys are
// API-native names; buildWebSearchTool() nests them under `filters`.
export interface AgentWebSearchOptions {
	search_type?: "web" | "fast";
	max_results?: number;
	max_tokens?: number;
	max_tokens_per_page?: number;
	search_context_size?: "low" | "medium" | "high";
	search_domain_filter?: string[];
	search_recency_filter?: "hour" | "day" | "week" | "month" | "year";
	search_after_date_filter?: string;
	search_before_date_filter?: string;
	last_updated_after_filter?: string;
	last_updated_before_filter?: string;
	user_location?: {
		country?: string;
		region?: string;
		city?: string;
		latitude?: number;
		longitude?: number;
	};
}

export interface AgentRetrieveArgs {
	response_id: string;
}

export interface AgentCancelArgs {
	response_id: string;
}

export interface AgentFilesArgs {
	action: "list" | "content";
	response_id: string;
	// Required for action:"content".
	file_id?: string;
}

export interface ModelListArgs {
	// Optional client-side filter on the model's `owned_by` provider (e.g. "anthropic").
	provider?: string;
}

// Shape of GET /v1/models (SDK ModelListOutput, via client.models.list()).
export interface ModelListEntry {
	id: string;
	object?: string;
	created?: number;
	owned_by?: string;
}

export interface ModelListResponse {
	object?: string;
	data?: ModelListEntry[];
}

export interface EmbeddingsArgs {
	input: string | string[];
	model?: "pplx-embed-v1-0.6b" | "pplx-embed-v1-4b";
	dimensions?: number;
	// base64_int8: base64 signed int8. base64_binary: packed 1 bit per dimension.
	encoding_format?: "base64_int8" | "base64_binary";
	full?: boolean;
}

export interface ContextualizedEmbeddingsArgs {
	// Nested array: each inner array is the chunk set for one document. Chunks
	// within a document share context awareness. Max 512 documents, 16,000
	// chunks total, 32K tokens/document, 120K tokens/request.
	input: string[][];
	model?: "pplx-embed-context-v1-0.6b" | "pplx-embed-context-v1-4b";
	dimensions?: number;
	encoding_format?: "base64_int8" | "base64_binary";
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

// set_model: a Sonar model id, or "auto" to reset to the default model with
// keyword auto-selection re-enabled.
export interface SetModelArgs {
	model: string;
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

/**
 * Per-request context the CallTool dispatcher passes to every handler as the
 * second argument. `signal` is the MCP request's AbortSignal (fires on
 * notifications/cancelled); handlers forward the whole context to
 * PerplexityApiService methods, which pass `{ signal }` to the SDK.
 */
export interface HandlerContext {
	signal?: AbortSignal;
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
	stop?: string | string[];
	temperature?: number;
	top_p?: number;
	max_tokens?: number;
	web_search_options?: WebSearchOptions;
	response_format?: ResponseFormat;
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

export const VALID_CONTEXTUALIZED_EMBEDDING_MODELS = [
	"pplx-embed-context-v1-0.6b",
	"pplx-embed-context-v1-4b",
] as const;

// Per-model request caps for contextualized embeddings.
export const MAX_CONTEXTUALIZED_DOCUMENTS = 512;
export const MAX_CONTEXTUALIZED_CHUNKS = 16000;

// Documented Agent API effort levels (docs.perplexity.ai/docs/agent-api/effort,
// 2026-11-12). Informational only: `effort` is NOT enum-checked, because the
// API also takes "name@latest" / "name@<version>" pins and adds levels over
// time. "wide-research" is a legacy alias the API still accepts (now xhigh).
export const AGENT_EFFORT_LEVELS = ["fast", "low", "medium", "high", "xhigh", "ultra"] as const;

// Light format check for effort/preset: a lowercase name, optionally pinned
// with "@latest" or "@<version>" (e.g. "low@2026-11-11.0"). The API owns the
// real validation and 400s unknown names/versions.
export const AGENT_EFFORT_PATTERN = /^[a-z][a-z0-9-]{0,63}(@[A-Za-z0-9][A-Za-z0-9._-]{0,63})?$/;

// Default effort for a bare agent({ input }) call (no model/models/effort/profile).
export const DEFAULT_AGENT_EFFORT = "low";

// Agent API max_steps ceiling (raised from 100 to 500 in the Oct 2026 changelog).
export const MAX_AGENT_STEPS = 500;

// Agent API document-input cap per request.
export const MAX_AGENT_FILES = 30;

// Built-in tools the Agent API can invoke (SDK ResponsesCreateParams.tools).
export const VALID_AGENT_TOOLS = [
	"web_search",
	"fetch_url",
	"people_search",
	"finance_search",
	"sandbox",
	"image_search",
] as const;

export const VALID_AGENT_REASONING_EFFORT = [
	"none",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const;

// Built-in skill names. "office" is the umbrella covering all four leaf formats.
export const VALID_BUILTIN_SKILLS = [
	"office",
	"office/docx",
	"office/pdf",
	"office/pptx",
	"office/xlsx",
] as const;

// Max entries in the Agent API `skills` array.
export const MAX_AGENT_SKILLS = 16;

export const VALID_AGENT_TOOL_CHOICES = ["none", "auto", "required"] as const;

export type ValidModel = typeof VALID_MODELS[number];
export type ValidRecencyFilter = typeof VALID_RECENCY_FILTERS[number];
export type ValidEmbeddingModel = typeof VALID_EMBEDDING_MODELS[number];
export type ValidAgentTool = typeof VALID_AGENT_TOOLS[number];

// ---- Decisions API (POST /v1/decisions) ----

export const VALID_DECISION_QUESTION_TYPES = ["noul", "choice", "score"] as const;
export type DecisionQuestionType = typeof VALID_DECISION_QUESTION_TYPES[number];

// noul: yes/no probability. choice: pick one of `criteria` keys (1-255).
// score: ordered rubric, `criteria` is an array of 1-10 level descriptions.
export interface DecisionQuestion {
	type: DecisionQuestionType;
	instructions?: unknown;
	criteria?: unknown;
}

export interface DecisionsArgs {
	state: string | Record<string, unknown> | unknown[];
	questions: Record<string, DecisionQuestion>;
	model?: string;
	mode?: "web_grounding";
	max_staleness?: number;
}

// API limits enforced client-side for clearer errors (the API's own 400 for a
// bad body is a generic "unknown or mistyped field").
export const MAX_DECISION_CHOICE_OPTIONS = 255;
export const MAX_DECISION_SCORE_LEVELS = 10;
export const MAX_DECISION_WEB_GROUNDING_QUESTIONS = 100;

// ---- Skills management (GET /v1/skills, GET /v1/skills/{id}) ----

export interface SkillsArgs {
	skill_id?: string;
	revision?: string;
	limit?: number;
	page_token?: string;
}
