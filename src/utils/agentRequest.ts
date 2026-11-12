/**
 * Agent API request-building helpers. Pure functions (no SDK, no I/O) so they
 * can be reused by any Agent-backed code path (the `agent` tool's
 * agentRespond(), and Sonar-to-Agent reformulations) and unit-tested directly.
 */

import { AgentWebSearchOptions, AgentInputFile, AgentApprovalResponse } from "../schemas/types.js";

// Keys of AgentWebSearchOptions that the API nests under web_search.filters.
const WEB_SEARCH_FILTER_KEYS = [
	"search_domain_filter",
	"search_recency_filter",
	"search_after_date_filter",
	"search_before_date_filter",
	"last_updated_after_filter",
	"last_updated_before_filter",
] as const;

// Keys of AgentWebSearchOptions that sit at the top level of the tool entry.
const WEB_SEARCH_TOP_LEVEL_KEYS = [
	"search_type",
	"max_results",
	"max_tokens",
	"max_tokens_per_page",
	"search_context_size",
	"user_location",
] as const;

/**
 * Builds a `{ type: "web_search", ... }` Agent API tool entry from the flat
 * AgentWebSearchOptions shape. Filter keys (domain/recency/date) are nested
 * under `filters`; everything else stays top-level. Undefined keys and an
 * empty `filters` object are omitted, so `buildWebSearchTool({})` is just
 * `{ type: "web_search" }`. Field names verified live 2026-11-12.
 */
export function buildWebSearchTool(opts: AgentWebSearchOptions = {}): Record<string, unknown> {
	const entry: Record<string, unknown> = { type: "web_search" };
	for (const key of WEB_SEARCH_TOP_LEVEL_KEYS) {
		if (opts[key] !== undefined) entry[key] = opts[key];
	}
	const filters: Record<string, unknown> = {};
	for (const key of WEB_SEARCH_FILTER_KEYS) {
		if (opts[key] !== undefined) filters[key] = opts[key];
	}
	if (Object.keys(filters).length > 0) entry["filters"] = filters;
	return entry;
}

/** One `input_file` content part. Callers validate exactly-one-of url/data. */
export function buildInputFilePart(file: AgentInputFile): Record<string, unknown> {
	const part: Record<string, unknown> = { type: "input_file" };
	if (file.file_url !== undefined) part["file_url"] = file.file_url;
	if (file.file_data !== undefined) part["file_data"] = file.file_data;
	if (file.filename !== undefined) part["filename"] = file.filename;
	return part;
}

/** One `mcp_approval_response` input item. `reason` is only sent on a denial. */
export function buildApprovalResponseItem(r: AgentApprovalResponse): Record<string, unknown> {
	const item: Record<string, unknown> = {
		type: "mcp_approval_response",
		approval_request_id: r.approval_request_id,
		approve: r.approve,
	};
	if (!r.approve && r.reason !== undefined) item["reason"] = r.reason;
	return item;
}

/**
 * Builds the Agent API `input` value. A bare string when there are no
 * attachments or approvals (the common case); otherwise an item array:
 * approval responses first, then one user message holding input_text plus
 * input_image / input_file parts. The message is omitted when the text is
 * empty and nothing is attached (a pure approval continuation).
 */
export function buildAgentInput(
	text: string,
	images: string[] = [],
	files: AgentInputFile[] = [],
	approvals: AgentApprovalResponse[] = []
): unknown {
	if (images.length === 0 && files.length === 0 && approvals.length === 0) return text;

	const items: Array<Record<string, unknown>> = approvals.map(buildApprovalResponseItem);
	const content: Array<Record<string, unknown>> = [];
	if (text.trim().length > 0) content.push({ type: "input_text", text });
	content.push(...images.map((url) => ({ type: "input_image", image_url: url })));
	content.push(...files.map(buildInputFilePart));
	if (content.length > 0) items.push({ type: "message", role: "user", content });
	return items;
}
