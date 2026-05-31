/**
 * Request validation functions with MCP-compliant error handling
 */

import {
	SearchArgs,
	DomainArgs,
	RecencyArgs,
	ModelArgs,
	RawSearchArgs,
	AsyncResearchArgs,
	AgentArgs,
	AgentRetrieveArgs,
	ModelListArgs,
	EmbeddingsArgs,
	VALID_MODELS,
	VALID_EMBEDDING_MODELS,
	VALID_AGENT_TOOLS,
	VALID_AGENT_REASONING_EFFORT,
} from "./types.js";
import { DEFAULT_EMBEDDING_MODEL } from "../config/constants.js";

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
	return true;
};

export const isValidRawSearchArgs = (args: unknown): args is RawSearchArgs => {
	if (typeof args !== "object" || args === null) return false;
	const a = args as RawSearchArgs;
	const queryOk =
		(typeof a.query === "string" && a.query.trim().length > 0) ||
		(isStringArray(a.query) && (a.query as string[]).length > 0);
	if (!queryOk) return false;
	if (a.max_results !== undefined && (typeof a.max_results !== "number" || a.max_results < 1 || a.max_results > 20)) return false;
	if (a.max_tokens !== undefined && typeof a.max_tokens !== "number") return false;
	if (a.max_tokens_per_page !== undefined && typeof a.max_tokens_per_page !== "number") return false;
	if (a.search_mode !== undefined && !["web", "academic", "sec"].includes(a.search_mode)) return false;
	if (a.search_type !== undefined && !["web", "people"].includes(a.search_type)) return false;
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

export const isValidAgentArgs = (args: unknown): args is AgentArgs => {
	if (typeof args !== "object" || args === null) return false;
	const a = args as AgentArgs;
	if (typeof a.input !== "string" || a.input.trim().length === 0) return false;
	if (a.model !== undefined && typeof a.model !== "string") return false;
	if (a.models !== undefined && !isStringArray(a.models)) return false;
	if (a.preset !== undefined && typeof a.preset !== "string") return false;
	if (a.instructions !== undefined && typeof a.instructions !== "string") return false;
	if (a.max_steps !== undefined && (typeof a.max_steps !== "number" || a.max_steps < 1)) return false;
	if (a.max_output_tokens !== undefined && typeof a.max_output_tokens !== "number") return false;
	if (a.language_preference !== undefined && typeof a.language_preference !== "string") return false;
	if (a.tools !== undefined && (!Array.isArray(a.tools) || !a.tools.every((t) => (VALID_AGENT_TOOLS as readonly string[]).includes(t)))) return false;
	if (a.reasoning_effort !== undefined && !(VALID_AGENT_REASONING_EFFORT as readonly string[]).includes(a.reasoning_effort)) return false;
	if (a.response_format !== undefined && !isValidResponseFormat(a.response_format)) return false;
	if (a.background !== undefined && typeof a.background !== "boolean") return false;
	return true;
};

export const isValidAgentRetrieveArgs = (args: unknown): args is AgentRetrieveArgs =>
	typeof args === "object" &&
	args !== null &&
	typeof (args as AgentRetrieveArgs).response_id === "string" &&
	(args as AgentRetrieveArgs).response_id.trim().length > 0;

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

export const isValidModelArgs = (args: unknown): args is ModelArgs =>
	typeof args === "object" &&
	args !== null &&
	((args as ModelArgs).model === undefined ||
		(typeof (args as ModelArgs).model === "string" &&
			VALID_MODELS.includes((args as ModelArgs).model as any)));
