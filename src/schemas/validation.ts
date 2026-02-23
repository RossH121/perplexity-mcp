/**
 * Request validation functions with MCP-compliant error handling
 */

import { SearchArgs, DomainArgs, RecencyArgs, ModelArgs, RawSearchArgs, VALID_MODELS } from "./types.js";

export const isValidSearchArgs = (args: unknown): args is SearchArgs => {
	if (typeof args !== "object" || args === null) return false;
	const a = args as SearchArgs;
	if (typeof a.query !== "string" || a.query.trim().length === 0) return false;
	if (a.stream !== undefined && typeof a.stream !== "boolean") return false;
	if (a.search_context_size !== undefined && !["low", "medium", "high"].includes(a.search_context_size)) return false;
	if (a.reasoning_effort !== undefined && !["minimal", "low", "medium", "high"].includes(a.reasoning_effort)) return false;
	if (a.strip_thinking !== undefined && typeof a.strip_thinking !== "boolean") return false;
	if (a.search_mode !== undefined && !["web", "academic", "sec"].includes(a.search_mode)) return false;
	return true;
};

export const isValidRawSearchArgs = (args: unknown): args is RawSearchArgs => {
	if (typeof args !== "object" || args === null) return false;
	const a = args as RawSearchArgs;
	if (typeof a.query !== "string" || a.query.trim().length === 0) return false;
	if (a.max_results !== undefined && (typeof a.max_results !== "number" || a.max_results < 1 || a.max_results > 20)) return false;
	if (a.search_mode !== undefined && !["web", "academic", "sec"].includes(a.search_mode)) return false;
	if (a.recency !== undefined && !["hour", "day", "week", "month", "year"].includes(a.recency)) return false;
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
