/**
 * Request validation functions with MCP-compliant error handling
 */

import {
	SearchArgs,
	DomainArgs,
	RecencyArgs,
	ModelArgs,
	SetModelArgs,
	RawSearchArgs,
	AsyncResearchArgs,
	AsyncResearchSubmitArgs,
	AsyncResearchStatusArgs,
	AgentArgs,
	AgentRetrieveArgs,
	AgentCancelArgs,
	AgentFilesArgs,
	ModelListArgs,
	EmbeddingsArgs,
	ContextualizedEmbeddingsArgs,
	VALID_MODELS,
	VALID_EMBEDDING_MODELS,
	VALID_CONTEXTUALIZED_EMBEDDING_MODELS,
	MAX_CONTEXTUALIZED_DOCUMENTS,
	MAX_CONTEXTUALIZED_CHUNKS,
	VALID_AGENT_TOOLS,
	VALID_AGENT_REASONING_EFFORT,
	VALID_BUILTIN_SKILLS,
	MAX_AGENT_SKILLS,
	AGENT_EFFORT_PATTERN,
	MAX_AGENT_STEPS,
	MAX_AGENT_FILES,
	VALID_AGENT_TOOL_CHOICES,
} from "./types.js";
import { DEFAULT_EMBEDDING_MODEL } from "../config/constants.js";
import {
	DecisionsArgs,
	SkillsArgs,
	VALID_DECISION_QUESTION_TYPES,
	MAX_DECISION_CHOICE_OPTIONS,
	MAX_DECISION_SCORE_LEVELS,
	MAX_DECISION_WEB_GROUNDING_QUESTIONS,
} from "./types.js";

const isStringArray = (v: unknown): boolean =>
	Array.isArray(v) && v.every((s) => typeof s === "string");

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

// Validates the shared response_format shape: { type:'json_schema', json_schema:{ schema, name?, ... } }
const isValidResponseFormat = (v: unknown): boolean => {
	if (!isPlainObject(v)) return false;
	if (v.type !== "json_schema") return false;
	const js = v.json_schema;
	if (!isPlainObject(js)) return false;
	if (!isPlainObject(js.schema)) return false;
	if (js.name !== undefined && typeof js.name !== "string") return false;
	if (js.description !== undefined && typeof js.description !== "string") return false;
	if (js.strict !== undefined && typeof js.strict !== "boolean") return false;
	return true;
};

export const isValidSearchArgs = (args: unknown): args is SearchArgs => {
	if (typeof args !== "object" || args === null) return false;
	const a = args as SearchArgs;
	if (typeof a.query !== "string" || a.query.trim().length === 0) return false;
	if (a.stream !== undefined && typeof a.stream !== "boolean") return false;
	if (a.search_context_size !== undefined && !["low", "medium", "high"].includes(a.search_context_size)) return false;
	if (a.search_type !== undefined && !["fast", "pro", "auto"].includes(a.search_type)) return false;
	if (a.reasoning_effort !== undefined && !["minimal", "low", "medium", "high"].includes(a.reasoning_effort)) return false;
	if (a.strip_thinking !== undefined && typeof a.strip_thinking !== "boolean") return false;
	if (a.search_mode !== undefined && !["web", "academic", "sec"].includes(a.search_mode)) return false;
	if (a.stream_mode !== undefined && !["full", "concise"].includes(a.stream_mode)) return false;
	if (a.disable_search !== undefined && typeof a.disable_search !== "boolean") return false;
	if (a.enable_search_classifier !== undefined && typeof a.enable_search_classifier !== "boolean") return false;
	if (a.return_images !== undefined && typeof a.return_images !== "boolean") return false;
	if (a.return_related_questions !== undefined && typeof a.return_related_questions !== "boolean") return false;
	if (a.show_cost !== undefined && typeof a.show_cost !== "boolean") return false;
	if (a.search_after_date !== undefined && typeof a.search_after_date !== "string") return false;
	if (a.search_before_date !== undefined && typeof a.search_before_date !== "string") return false;
	if (a.last_updated_after !== undefined && typeof a.last_updated_after !== "string") return false;
	if (a.last_updated_before !== undefined && typeof a.last_updated_before !== "string") return false;
	if (a.language_preference !== undefined && typeof a.language_preference !== "string") return false;
	if (a.country !== undefined && typeof a.country !== "string") return false;
	if (a.latitude !== undefined && typeof a.latitude !== "number") return false;
	if (a.longitude !== undefined && typeof a.longitude !== "number") return false;
	if (a.city !== undefined && typeof a.city !== "string") return false;
	if (a.region !== undefined && typeof a.region !== "string") return false;
	if (a.recency !== undefined && !["hour", "day", "week", "month", "year"].includes(a.recency)) return false;
	if (a.stop !== undefined && typeof a.stop !== "string" && !isStringArray(a.stop)) return false;
	if (a.temperature !== undefined && (typeof a.temperature !== "number" || a.temperature < 0 || a.temperature > 2)) return false;
	if (a.top_p !== undefined && (typeof a.top_p !== "number" || a.top_p < 0 || a.top_p > 1)) return false;
	if (a.max_tokens !== undefined && (typeof a.max_tokens !== "number" || a.max_tokens < 1)) return false;
	if (a.search_language_filter !== undefined && !isStringArray(a.search_language_filter)) return false;
	if (a.image_domain_filter !== undefined && !isStringArray(a.image_domain_filter)) return false;
	if (a.image_format_filter !== undefined && !isStringArray(a.image_format_filter)) return false;
	if (a.image_results_enhanced_relevance !== undefined && typeof a.image_results_enhanced_relevance !== "boolean") return false;
	if (a.response_format !== undefined && !isValidResponseFormat(a.response_format)) return false;
	if (a.search_domain_filter !== undefined && searchDomainFilterError(a.search_domain_filter) !== null) return false;
	if (a.effort !== undefined && (typeof a.effort !== "string" || !AGENT_EFFORT_PATTERN.test(a.effort))) return false;
	return true;
};

/**
 * Per-call `search_domain_filter` on the search tool. Same rules as the
 * stateful domain_filter / FilterState: at most 20 domains, a '-' prefix
 * excludes, and one list is either all-allow or all-exclude (the API's
 * allowlist and denylist modes cannot be mixed). [] is allowed and means "no
 * domain filter for this call". Returns null when valid.
 */
export function searchDomainFilterError(v: unknown): string | null {
	if (!isStringArray(v)) return "'search_domain_filter' must be an array of domain strings.";
	const list = v as string[];
	if (list.length > 20) return "'search_domain_filter' allows at most 20 domains.";
	if (list.some((d) => d.replace(/^-/, "").trim().length === 0)) {
		return "'search_domain_filter' entries must be non-empty domains (e.g. 'nodejs.org' or '-pinterest.com').";
	}
	const excluded = list.filter((d) => d.startsWith("-")).length;
	if (excluded > 0 && excluded < list.length) {
		return "'search_domain_filter' cannot mix allowed and '-'-excluded domains; use one mode per call.";
	}
	return null;
}

// /search rejects more than 5 queries per request (400 "maximum 5 queries allowed",
// verified live 2026-11-12). Each query counts separately against the rate limit.
const MAX_RAW_SEARCH_QUERIES = 5;

export const isValidRawSearchArgs = (args: unknown): args is RawSearchArgs => {
	if (typeof args !== "object" || args === null) return false;
	const a = args as RawSearchArgs;
	const queryOk =
		(typeof a.query === "string" && a.query.trim().length > 0) ||
		(isStringArray(a.query) &&
			(a.query as string[]).length > 0 &&
			(a.query as string[]).length <= MAX_RAW_SEARCH_QUERIES &&
			(a.query as string[]).every((q) => q.trim().length > 0));
	if (!queryOk) return false;
	// /search caps max_results at 20, or 50 with search_type "people" (verified live 2026-11-12).
	const maxResultsCap = a.search_type === "people" ? 50 : 20;
	if (a.max_results !== undefined && (typeof a.max_results !== "number" || a.max_results < 1 || a.max_results > maxResultsCap)) return false;
	if (a.max_tokens !== undefined && typeof a.max_tokens !== "number") return false;
	if (a.max_tokens_per_page !== undefined && typeof a.max_tokens_per_page !== "number") return false;
	if (a.search_context_size !== undefined && !["low", "medium", "high"].includes(a.search_context_size)) return false;
	if (a.search_type !== undefined && !["web", "fast", "people"].includes(a.search_type)) return false;
	if (a.recency !== undefined && !["hour", "day", "week", "month", "year"].includes(a.recency)) return false;
	if (a.search_after_date !== undefined && typeof a.search_after_date !== "string") return false;
	if (a.search_before_date !== undefined && typeof a.search_before_date !== "string") return false;
	if (a.last_updated_after !== undefined && typeof a.last_updated_after !== "string") return false;
	if (a.last_updated_before !== undefined && typeof a.last_updated_before !== "string") return false;
	if (a.search_language_filter !== undefined && !isStringArray(a.search_language_filter)) return false;
	if (a.search_domain_filter !== undefined && (!isStringArray(a.search_domain_filter) || (a.search_domain_filter as string[]).length > 20)) return false;
	if (a.country !== undefined && typeof a.country !== "string") return false;
	return true;
};

export const isValidAsyncResearchSubmitArgs = (args: unknown): args is AsyncResearchSubmitArgs => {
	if (typeof args !== "object" || args === null) return false;
	const a = args as AsyncResearchArgs;
	if (typeof a.query !== "string" || a.query.trim().length === 0) return false;
	if (a.model !== undefined && !VALID_MODELS.includes(a.model as any)) return false;
	if (a.reasoning_effort !== undefined && !["minimal", "low", "medium", "high"].includes(a.reasoning_effort)) return false;
	if (a.search_mode !== undefined && !["web", "academic", "sec"].includes(a.search_mode)) return false;
	return true;
};

export const isValidAsyncResearchStatusArgs = (args: unknown): args is AsyncResearchStatusArgs => {
	if (typeof args !== "object" || args === null) return false;
	const a = args as AsyncResearchArgs;
	if (typeof a.request_id !== "string" || a.request_id.trim().length === 0) return false;
	if (a.strip_thinking !== undefined && typeof a.strip_thinking !== "boolean") return false;
	return true;
};

/** Deprecated combined async_research tool (kept as an alias for one release). */
export const isValidAsyncResearchArgs = (args: unknown): args is AsyncResearchArgs => {
	if (typeof args !== "object" || args === null) return false;
	const a = args as AsyncResearchArgs;
	if (!["submit", "status", "list"].includes(a.action)) return false;
	if (a.action === "submit" && (typeof a.query !== "string" || a.query.trim().length === 0)) return false;
	if (a.action === "status" && (typeof a.request_id !== "string" || a.request_id.trim().length === 0)) return false;
	if (a.model !== undefined && !VALID_MODELS.includes(a.model as any)) return false;
	if (a.reasoning_effort !== undefined && !["minimal", "low", "medium", "high"].includes(a.reasoning_effort)) return false;
	if (a.search_mode !== undefined && !["web", "academic", "sec"].includes(a.search_mode)) return false;
	if (a.strip_thinking !== undefined && typeof a.strip_thinking !== "boolean") return false;
	return true;
};

/**
 * Validates `agent` arguments. Returns null when valid, otherwise a specific,
 * caller-actionable message (surfaced verbatim by AgentHandler).
 */
export const agentArgsError = (args: unknown): string | null => {
	if (!isPlainObject(args)) return "Arguments must be an object.";
	const a = args as unknown as AgentArgs;

	const approvals = a.approval_responses;
	if (approvals !== undefined) {
		if (!Array.isArray(approvals) || approvals.length === 0) return "'approval_responses' must be a non-empty array.";
		for (const r of approvals) {
			if (!isPlainObject(r)) return "Each 'approval_responses' entry must be an object.";
			if (typeof r.approval_request_id !== "string" || r.approval_request_id.trim().length === 0) {
				return "Each 'approval_responses' entry needs an 'approval_request_id' (the mcp_approval_request id).";
			}
			if (typeof r.approve !== "boolean") return "Each 'approval_responses' entry needs a boolean 'approve'.";
			if (r.reason !== undefined && typeof r.reason !== "string") return "'approval_responses[].reason' must be a string.";
			if (r.approve && r.reason !== undefined) return "'approval_responses[].reason' is only allowed when approve is false.";
		}
		if (typeof a.previous_response_id !== "string" || a.previous_response_id.trim().length === 0) {
			return "'approval_responses' requires 'previous_response_id' (the run that returned the approval requests).";
		}
	}
	// 'input' is required, except on an approval continuation where it may be empty.
	if (typeof a.input !== "string") return "'input' must be a string.";
	if (a.input.trim().length === 0 && approvals === undefined) return "'input' must be a non-empty string.";

	if (a.model !== undefined && typeof a.model !== "string") return "'model' must be a string.";
	if (a.models !== undefined && !isStringArray(a.models)) return "'models' must be an array of strings.";
	for (const key of ["effort", "preset"] as const) {
		const v = a[key];
		if (v === undefined) continue;
		if (typeof v !== "string" || !AGENT_EFFORT_PATTERN.test(v)) {
			return `'${key}' must be an effort name (e.g. 'low'), optionally pinned as 'name@latest' or 'name@<version>'.`;
		}
	}
	if (a.profile !== undefined) {
		const p = a.profile as unknown;
		if (!isPlainObject(p) || p.type !== "custom") return "'profile' must be { type: 'custom', id, version? }.";
		if (typeof p.id !== "string" || p.id.trim().length === 0 || p.id.length > 128) return "'profile.id' must be a 1-128 character string.";
		if (p.version !== undefined && typeof p.version !== "string") return "'profile.version' must be a string.";
		if (a.effort !== undefined || a.preset !== undefined) {
			return "'profile' cannot be combined with 'effort' (or its alias 'preset'); the profile already selects its configuration. Drop one of them.";
		}
	}
	if (a.instructions !== undefined && typeof a.instructions !== "string") return "'instructions' must be a string.";
	if (a.max_steps !== undefined && (!Number.isInteger(a.max_steps) || a.max_steps < 1 || a.max_steps > MAX_AGENT_STEPS)) {
		return `'max_steps' must be an integer from 1 to ${MAX_AGENT_STEPS}.`;
	}
	if (a.max_output_tokens !== undefined && typeof a.max_output_tokens !== "number") return "'max_output_tokens' must be a number.";
	if (a.language_preference !== undefined && typeof a.language_preference !== "string") return "'language_preference' must be a string.";
	if (a.tools !== undefined && (!Array.isArray(a.tools) || !a.tools.every((t) => (VALID_AGENT_TOOLS as readonly string[]).includes(t)))) {
		return `'tools' entries must be one of: ${VALID_AGENT_TOOLS.join(", ")}.`;
	}
	if (a.tool_choice !== undefined && !(VALID_AGENT_TOOL_CHOICES as readonly string[]).includes(a.tool_choice)) {
		return `'tool_choice' must be one of: ${VALID_AGENT_TOOL_CHOICES.join(", ")}.`;
	}
	if (a.web_search_options !== undefined) {
		const err = webSearchOptionsError(a.web_search_options);
		if (err) return err;
	}
	if (a.reasoning_effort !== undefined && !(VALID_AGENT_REASONING_EFFORT as readonly string[]).includes(a.reasoning_effort)) {
		return `'reasoning_effort' must be one of: ${VALID_AGENT_REASONING_EFFORT.join(", ")}.`;
	}
	if (a.response_format !== undefined && !isValidResponseFormat(a.response_format)) return "'response_format' must be { type: 'json_schema', json_schema: { schema, ... } }.";
	if (a.background !== undefined && typeof a.background !== "boolean") return "'background' must be a boolean.";
	if (a.mcp_servers !== undefined) {
		if (!Array.isArray(a.mcp_servers)) return "'mcp_servers' must be an array.";
		for (const s of a.mcp_servers) {
			if (!isPlainObject(s)) return "Each 'mcp_servers' entry must be an object.";
			if (typeof s.server_label !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(s.server_label)) {
				return "'mcp_servers[].server_label' must match ^[a-zA-Z0-9_-]{1,64}$.";
			}
			if (typeof s.server_url !== "string" || !s.server_url.startsWith("https://")) return "'mcp_servers[].server_url' must be an https:// URL.";
			if (s.authorization !== undefined && typeof s.authorization !== "string") return "'mcp_servers[].authorization' must be a string.";
			if (s.headers !== undefined && !isPlainObject(s.headers)) return "'mcp_servers[].headers' must be an object.";
			if (s.allowed_tools !== undefined && !isStringArray(s.allowed_tools)) return "'mcp_servers[].allowed_tools' must be an array of strings.";
			if (s.defer_loading !== undefined && typeof s.defer_loading !== "boolean") return "'mcp_servers[].defer_loading' must be a boolean.";
			if (s.require_approval !== undefined && !isValidRequireApproval(s.require_approval)) {
				return "'mcp_servers[].require_approval' must be 'always', 'never', or { always?: {tool_names?, read_only?}, never?: {...} }.";
			}
		}
		// server_label must be unique per request.
		const labels = a.mcp_servers.map((s) => s.server_label);
		if (new Set(labels).size !== labels.length) return "'mcp_servers[].server_label' values must be unique.";
	}
	if (a.skills !== undefined) {
		if (!Array.isArray(a.skills) || a.skills.length > MAX_AGENT_SKILLS) return `'skills' must be an array of at most ${MAX_AGENT_SKILLS} entries.`;
		for (const s of a.skills) {
			if (!isPlainObject(s)) return "Each 'skills' entry must be an object.";
			if (s.type === "custom") {
				if (typeof s.id !== "string" || s.id.trim().length === 0) return "Custom skills need an 'id' (e.g. 'skill_...').";
				if (s.version !== undefined && typeof s.version !== "string") return "'skills[].version' must be a string.";
				continue;
			}
			if (s.type !== "builtin" && s.type !== "inline") return "'skills[].type' must be 'builtin', 'inline', or 'custom'.";
			if (typeof s.name !== "string" || s.name.trim().length === 0) return "Builtin and inline skills need a 'name'.";
			if (s.type === "builtin") {
				if (!(VALID_BUILTIN_SKILLS as readonly string[]).includes(s.name)) return `Builtin skill names: ${VALID_BUILTIN_SKILLS.join(", ")}.`;
			} else {
				// Inline skills carry their own definition; both fields are required.
				if (typeof s.description !== "string" || s.description.trim().length === 0) return "Inline skills need a non-empty 'description'.";
				if (typeof s.instructions !== "string" || s.instructions.trim().length === 0) return "Inline skills need non-empty 'instructions'.";
			}
		}
	}
	if (a.previous_response_id !== undefined && typeof a.previous_response_id !== "string") return "'previous_response_id' must be a string.";
	if (a.store !== undefined && typeof a.store !== "boolean") return "'store' must be a boolean.";
	if (a.temperature !== undefined && typeof a.temperature !== "number") return "'temperature' must be a number.";
	if (a.top_p !== undefined && typeof a.top_p !== "number") return "'top_p' must be a number.";
	if (a.service_tier !== undefined && typeof a.service_tier !== "string") return "'service_tier' must be a string.";
	if (a.prompt_cache_key !== undefined && typeof a.prompt_cache_key !== "string") return "'prompt_cache_key' must be a string.";
	if (a.images !== undefined && (!isStringArray(a.images) || (a.images as string[]).length === 0)) return "'images' must be a non-empty array of URL strings.";
	if (a.files !== undefined) {
		if (!Array.isArray(a.files) || a.files.length === 0 || a.files.length > MAX_AGENT_FILES) {
			return `'files' must be a non-empty array of at most ${MAX_AGENT_FILES} entries.`;
		}
		for (const f of a.files) {
			if (!isPlainObject(f)) return "Each 'files' entry must be an object.";
			const hasUrl = f.file_url !== undefined;
			const hasData = f.file_data !== undefined;
			if (hasUrl === hasData) return "Each 'files' entry needs exactly one of 'file_url' or 'file_data'.";
			if (hasUrl && (typeof f.file_url !== "string" || !f.file_url.startsWith("https://"))) return "'files[].file_url' must be a public https:// URL.";
			if (hasData && (typeof f.file_data !== "string" || f.file_data.length === 0)) return "'files[].file_data' must be a non-empty base64 string or data: URI.";
			if (f.filename !== undefined && typeof f.filename !== "string") return "'files[].filename' must be a string.";
		}
	}
	return null;
};

export const isValidAgentArgs = (args: unknown): args is AgentArgs => agentArgsError(args) === null;

const isValidApprovalFilter = (v: unknown): boolean =>
	v === null ||
	(isPlainObject(v) &&
		(v.tool_names === undefined || v.tool_names === null || isStringArray(v.tool_names)) &&
		(v.read_only === undefined || v.read_only === null || typeof v.read_only === "boolean"));

const isValidRequireApproval = (v: unknown): boolean => {
	if (v === "always" || v === "never") return true;
	if (!isPlainObject(v)) return false;
	if (Object.keys(v).some((k) => k !== "always" && k !== "never")) return false;
	return (v.always === undefined || isValidApprovalFilter(v.always)) && (v.never === undefined || isValidApprovalFilter(v.never));
};

const WEB_SEARCH_OPTION_KEYS = new Set([
	"search_type", "max_results", "max_tokens", "max_tokens_per_page", "search_context_size",
	"search_domain_filter", "search_recency_filter", "search_after_date_filter", "search_before_date_filter",
	"last_updated_after_filter", "last_updated_before_filter", "user_location",
]);

const webSearchOptionsError = (v: unknown): string | null => {
	if (!isPlainObject(v)) return "'web_search_options' must be an object.";
	const unknown = Object.keys(v).filter((k) => !WEB_SEARCH_OPTION_KEYS.has(k));
	if (unknown.length > 0) return `Unknown 'web_search_options' key(s): ${unknown.join(", ")}.`;
	if (v.search_type !== undefined && v.search_type !== "web" && v.search_type !== "fast") return "'web_search_options.search_type' must be 'web' or 'fast'.";
	if (v.max_results !== undefined && (!Number.isInteger(v.max_results) || (v.max_results as number) < 1 || (v.max_results as number) > 50)) {
		return "'web_search_options.max_results' must be an integer from 1 to 50.";
	}
	for (const k of ["max_tokens", "max_tokens_per_page"]) {
		if (v[k] !== undefined && (typeof v[k] !== "number" || (v[k] as number) < 1)) return `'web_search_options.${k}' must be a positive number.`;
	}
	if (v.search_context_size !== undefined && !["low", "medium", "high"].includes(v.search_context_size as string)) {
		return "'web_search_options.search_context_size' must be 'low', 'medium', or 'high'.";
	}
	if (v.search_domain_filter !== undefined) {
		if (!isStringArray(v.search_domain_filter) || (v.search_domain_filter as string[]).length > 20) {
			return "'web_search_options.search_domain_filter' must be an array of at most 20 domains.";
		}
	}
	if (v.search_recency_filter !== undefined && !["hour", "day", "week", "month", "year"].includes(v.search_recency_filter as string)) {
		return "'web_search_options.search_recency_filter' must be hour, day, week, month, or year.";
	}
	for (const k of ["search_after_date_filter", "search_before_date_filter", "last_updated_after_filter", "last_updated_before_filter"]) {
		if (v[k] !== undefined && typeof v[k] !== "string") return `'web_search_options.${k}' must be a date string (e.g. '3/1/2025').`;
	}
	// API rule (verified live 2026-11-12): "search_recency_filter cannot be used
	// together with search_after_date_filter or search_before_date_filter".
	if (v.search_recency_filter !== undefined && (v.search_after_date_filter !== undefined || v.search_before_date_filter !== undefined)) {
		return "'web_search_options.search_recency_filter' cannot be combined with search_after_date_filter/search_before_date_filter; use one or the other (last_updated_* filters are fine with either).";
	}
	if (v.user_location !== undefined) {
		const u = v.user_location;
		if (!isPlainObject(u)) return "'web_search_options.user_location' must be an object.";
		for (const k of ["country", "region", "city"]) {
			if (u[k] !== undefined && typeof u[k] !== "string") return `'web_search_options.user_location.${k}' must be a string.`;
		}
		for (const k of ["latitude", "longitude"]) {
			if (u[k] !== undefined && typeof u[k] !== "number") return `'web_search_options.user_location.${k}' must be a number.`;
		}
	}
	return null;
};

export const isValidAgentRetrieveArgs = (args: unknown): args is AgentRetrieveArgs =>
	typeof args === "object" &&
	args !== null &&
	typeof (args as AgentRetrieveArgs).response_id === "string" &&
	(args as AgentRetrieveArgs).response_id.trim().length > 0;

export const isValidAgentCancelArgs = (args: unknown): args is AgentCancelArgs =>
	typeof args === "object" &&
	args !== null &&
	typeof (args as AgentCancelArgs).response_id === "string" &&
	(args as AgentCancelArgs).response_id.trim().length > 0;

export const isValidAgentFilesArgs = (args: unknown): args is AgentFilesArgs => {
	if (typeof args !== "object" || args === null) return false;
	const a = args as AgentFilesArgs;
	if (a.action !== "list" && a.action !== "content") return false;
	if (typeof a.response_id !== "string" || a.response_id.trim().length === 0) return false;
	if (a.action === "content" && (typeof a.file_id !== "string" || a.file_id.trim().length === 0)) return false;
	return true;
};

// list_models takes no required args; `provider` is an optional string filter.
export const isValidModelListArgs = (args: unknown): args is ModelListArgs => {
	if (args === undefined || args === null) return true;
	if (typeof args !== "object") return false;
	const a = args as ModelListArgs;
	if (a.provider !== undefined && typeof a.provider !== "string") return false;
	return true;
};

// Per-model maximum embedding dimensions (floor is a shared 128).
const EMBEDDING_DIMENSION_CAPS: Record<string, number> = {
	"pplx-embed-v1-0.6b": 1024,
	"pplx-embed-v1-4b": 2560,
};
const EMBEDDING_DIMENSION_FLOOR = 128;

export const isValidEmbeddingsArgs = (args: unknown): args is EmbeddingsArgs => {
	if (typeof args !== "object" || args === null) return false;
	const a = args as EmbeddingsArgs;
	const inputOk =
		(typeof a.input === "string" && a.input.trim().length > 0) ||
		(isStringArray(a.input) &&
			(a.input as string[]).length > 0 &&
			(a.input as string[]).every((s) => s.trim().length > 0));
	if (!inputOk) return false;
	if (a.model !== undefined && !VALID_EMBEDDING_MODELS.includes(a.model as any)) return false;
	if (a.dimensions !== undefined) {
		if (typeof a.dimensions !== "number" || a.dimensions < EMBEDDING_DIMENSION_FLOOR) return false;
		const cap = EMBEDDING_DIMENSION_CAPS[a.model ?? DEFAULT_EMBEDDING_MODEL];
		if (cap !== undefined && a.dimensions > cap) return false;
	}
	if (a.encoding_format !== undefined && !["base64_int8", "base64_binary"].includes(a.encoding_format)) return false;
	if (a.full !== undefined && typeof a.full !== "boolean") return false;
	return true;
};

// Same per-model dimension caps as plain embeddings, on the -context- model names.
const CONTEXTUALIZED_DIMENSION_CAPS: Record<string, number> = {
	"pplx-embed-context-v1-0.6b": 1024,
	"pplx-embed-context-v1-4b": 2560,
};
const DEFAULT_CONTEXTUALIZED_MODEL = "pplx-embed-context-v1-0.6b";

export const isValidContextualizedEmbeddingsArgs = (args: unknown): args is ContextualizedEmbeddingsArgs => {
	if (typeof args !== "object" || args === null) return false;
	const a = args as ContextualizedEmbeddingsArgs;
	if (!Array.isArray(a.input) || a.input.length === 0 || a.input.length > MAX_CONTEXTUALIZED_DOCUMENTS) return false;
	let totalChunks = 0;
	for (const doc of a.input) {
		if (!isStringArray(doc) || (doc as string[]).length === 0) return false;
		if (!(doc as string[]).every((s) => s.trim().length > 0)) return false;
		totalChunks += (doc as string[]).length;
	}
	if (totalChunks > MAX_CONTEXTUALIZED_CHUNKS) return false;
	if (a.model !== undefined && !(VALID_CONTEXTUALIZED_EMBEDDING_MODELS as readonly string[]).includes(a.model)) return false;
	if (a.dimensions !== undefined) {
		if (typeof a.dimensions !== "number" || a.dimensions < EMBEDDING_DIMENSION_FLOOR) return false;
		const cap = CONTEXTUALIZED_DIMENSION_CAPS[a.model ?? DEFAULT_CONTEXTUALIZED_MODEL];
		if (cap !== undefined && a.dimensions > cap) return false;
	}
	if (a.encoding_format !== undefined && !["base64_int8", "base64_binary"].includes(a.encoding_format)) return false;
	if (a.full !== undefined && typeof a.full !== "boolean") return false;
	return true;
};

export const isValidDomainArgs = (args: unknown): args is DomainArgs =>
	typeof args === "object" &&
	args !== null &&
	typeof (args as DomainArgs).domain === "string" &&
	(args as DomainArgs).domain.trim().length > 0 &&
	["allow", "block"].includes((args as DomainArgs).action);

export const isValidRecencyArgs = (args: unknown): args is RecencyArgs =>
	typeof args === "object" &&
	args !== null &&
	typeof (args as RecencyArgs).filter === "string" &&
	["hour", "day", "week", "month", "year", "none"].includes(
		(args as RecencyArgs).filter,
	);

export const isValidSetModelArgs = (args: unknown): args is SetModelArgs =>
	typeof args === "object" &&
	args !== null &&
	typeof (args as SetModelArgs).model === "string" &&
	((args as SetModelArgs).model === "auto" || VALID_MODELS.includes((args as SetModelArgs).model as any));

export const isValidModelArgs = (args: unknown): args is ModelArgs =>
	typeof args === "object" &&
	args !== null &&
	((args as ModelArgs).model === undefined ||
		(typeof (args as ModelArgs).model === "string" &&
			VALID_MODELS.includes((args as ModelArgs).model as any)));

/**
 * Validate decisions arguments. Returns an error message, or null when valid.
 * Checked client-side because the API answers every malformed body with the
 * same generic 400 ("unknown or mistyped field"), which names no field.
 */
export function decisionsArgsError(args: unknown): string | null {
	if (!isPlainObject(args)) return "Arguments must be an object.";
	const a = args as Partial<DecisionsArgs>;
	if (a.state === undefined || a.state === null) return "'state' is required (string, object, or array).";
	if (typeof a.state === "string" && a.state.trim().length === 0) return "'state' must not be empty.";
	if (typeof a.state !== "string" && typeof a.state !== "object") return "'state' must be a string, object, or array.";
	if (a.model !== undefined && (typeof a.model !== "string" || a.model.trim().length === 0)) {
		return "'model' must be a non-empty string.";
	}
	if (a.mode !== undefined && a.mode !== "web_grounding") return "'mode' must be 'web_grounding' (or omitted).";
	if (a.max_staleness !== undefined && (!Number.isInteger(a.max_staleness) || a.max_staleness < 0)) {
		return "'max_staleness' must be a non-negative integer (seconds).";
	}
	if (!isPlainObject(a.questions) || Object.keys(a.questions).length === 0) {
		return "'questions' must be an object with at least one named question.";
	}
	const names = Object.keys(a.questions);
	if (a.mode === "web_grounding" && names.length > MAX_DECISION_WEB_GROUNDING_QUESTIONS) {
		return `With mode 'web_grounding', at most ${MAX_DECISION_WEB_GROUNDING_QUESTIONS} questions are allowed.`;
	}
	for (const name of names) {
		if (name.trim().length === 0) return "Question names must be non-empty.";
		const q = a.questions[name] as unknown;
		if (!isPlainObject(q)) return `Question '${name}' must be an object.`;
		const type = q.type;
		if (!VALID_DECISION_QUESTION_TYPES.includes(type as any)) {
			return `Question '${name}': 'type' must be one of ${VALID_DECISION_QUESTION_TYPES.join(", ")}.`;
		}
		const extra = Object.keys(q).filter((k) => !["type", "instructions", "criteria"].includes(k));
		if (extra.length > 0) return `Question '${name}': unknown field(s) ${extra.join(", ")}.`;
		if (type === "noul") {
			if (q.instructions == null && q.criteria == null) {
				return `Question '${name}' (noul) needs 'instructions' or 'criteria' ({true, false}).`;
			}
			if (q.criteria != null) {
				if (!isPlainObject(q.criteria)) return `Question '${name}' (noul): 'criteria' must be an object with 'true'/'false' keys.`;
				const bad = Object.keys(q.criteria).filter((k) => k !== "true" && k !== "false");
				if (bad.length > 0) return `Question '${name}' (noul): 'criteria' keys must be 'true' and/or 'false'.`;
			}
		} else if (type === "choice") {
			const n = isPlainObject(q.criteria) ? Object.keys(q.criteria).length : 0;
			if (n < 1 || n > MAX_DECISION_CHOICE_OPTIONS) {
				return `Question '${name}' (choice): 'criteria' must map 1-${MAX_DECISION_CHOICE_OPTIONS} option names to descriptions (or null).`;
			}
		} else if (type === "score") {
			if (!Array.isArray(q.criteria) || q.criteria.length < 1 || q.criteria.length > MAX_DECISION_SCORE_LEVELS) {
				return `Question '${name}' (score): 'criteria' must be an array of 1-${MAX_DECISION_SCORE_LEVELS} ordered level descriptions (index = score).`;
			}
		}
	}
	return null;
}

export const isValidSkillsArgs = (args: unknown): args is SkillsArgs => {
	if (args === undefined) return true;
	if (!isPlainObject(args)) return false;
	const a = args as SkillsArgs;
	if (a.skill_id !== undefined && (typeof a.skill_id !== "string" || a.skill_id.trim().length === 0)) return false;
	if (a.revision !== undefined && (typeof a.revision !== "string" || a.revision.trim().length === 0)) return false;
	if (a.revision !== undefined && a.skill_id === undefined) return false;
	if (a.limit !== undefined && (!Number.isInteger(a.limit) || a.limit < 1)) return false;
	if (a.page_token !== undefined && (typeof a.page_token !== "string" || a.page_token.length === 0)) return false;
	return true;
};
