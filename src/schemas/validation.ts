/**
 * Request validation functions with MCP-compliant error handling
 */

import { SearchArgs, DomainArgs, RecencyArgs, ModelArgs, VALID_MODELS } from "./types.js";

export const isValidSearchArgs = (args: unknown): args is SearchArgs =>
	typeof args === "object" &&
	args !== null &&
	typeof (args as SearchArgs).query === "string" &&
	(args as SearchArgs).query.trim().length > 0 &&
	((args as SearchArgs).stream === undefined || typeof (args as SearchArgs).stream === "boolean");

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
	["hour", "day", "week", "month", "none"].includes(
		(args as RecencyArgs).filter,
	);

export const isValidModelArgs = (args: unknown): args is ModelArgs =>
	typeof args === "object" &&
	args !== null &&
	((args as ModelArgs).model === undefined ||
		(typeof (args as ModelArgs).model === "string" &&
			VALID_MODELS.includes((args as ModelArgs).model as any)));