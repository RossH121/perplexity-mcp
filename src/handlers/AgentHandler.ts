/**
 * Handler for the agent tool, Perplexity Agent API via the responses surface.
 * Supports third-party models, effort levels, profiles, built-in tools
 * (web_search, fetch_url, people_search, finance_search, sandbox,
 * image_search), remote MCP servers with approvals, document/image input,
 * structured output, nested reasoning effort, and background (queued) runs.
 */

import { McpRequest, HandlerContext, AgentArgs, ModelListEntry } from "../schemas/types.js";
import { agentArgsError } from "../schemas/validation.js";
import { PerplexityApiService } from "../services/PerplexityApiService.js";
import { ErrorHandler, extractErrorMessage } from "../utils/errorHandling.js";
import { renderSearchResults } from "../utils/responseFormatting.js";
import { numOrNull, strOrNull, structuredResult, toSources } from "../utils/structuredResult.js";
import { agentFileUri } from "../utils/agentFileUri.js";

// Still-running statuses on the responses surface. `requires_action` is in the
// SDK's StatusInput enum though no doc lists it; `cancelling` is what cancel
// returns while the run winds down.
const PENDING_STATUSES = new Set(["queued", "in_progress", "requires_action", "cancelling"]);

// Heuristic for "the API rejected our model/models value": the Agent API's
// error text for this case has consistently mentioned "model" (e.g. "invalid
// model", "model not found"), unlike auth/rate-limit/tool errors.
const MODEL_ERROR_PATTERN = /\bmodel(s)?\b/i;

// Cap on how much of one MCP tool call's output is echoed back. The model has
// already consumed the full output; this is a trace, not the answer.
const MAX_MCP_OUTPUT_CHARS = 500;

function truncate(s: string, max: number): string {
	return s.length > max ? `${s.slice(0, max)}… (${s.length - max} more chars)` : s;
}

/** `[Agent model: X | effort: low@2026-11-11.0 | service_tier: flex]`, or "" when nothing to show. */
function headerLine(resp: any): string {
	const parts: string[] = [];
	if (resp?.model) parts.push(`Agent model: ${resp.model}`);
	// `preset` is the deprecated echo of the same value; prefer `effort`.
	const effort = resp?.effort ?? resp?.preset;
	if (effort) parts.push(`effort: ${effort}`);
	if (resp?.service_tier) parts.push(`service_tier: ${resp.service_tier}`);
	return parts.length > 0 ? `[${parts.join(" | ")}]\n\n` : "";
}

/** Why a run stopped short: incomplete reason, error message, and/or pause state. */
function statusDetail(resp: any): string {
	const details: string[] = [];
	const reason = resp?.incomplete_details?.reason;
	if (reason) details.push(`reason: ${reason}`);
	const errMsg = resp?.error?.message;
	if (errMsg) details.push(`error: ${errMsg}${resp.error.code ? ` (${resp.error.code})` : ""}`);
	if (resp?.paused) {
		const p = resp.paused;
		const why = typeof p === "object" ? p.reason ?? p.type ?? JSON.stringify(p) : String(p);
		details.push(`paused: ${why}`);
	}
	return details.join("; ");
}

/**
 * Renders an Agent API response object into display text. Shared by the `agent`
 * and `agent_retrieve` tools so submit and poll render identically. For a
 * still-running background job, returns an id + status block instead of output.
 */
export function renderAgentResponse(resp: any): string {
	const header = headerLine(resp);
	const status: string | undefined = resp?.status;
	const output: any[] = Array.isArray(resp?.output) ? resp.output : [];

	// Prefer the SDK convenience field; fall back to aggregating message output items.
	let text: string = resp?.output_text ?? "";
	if (!text) {
		text = output
			.filter((o: any) => o?.type === "message")
			.flatMap((o: any) => (o.content ?? []))
			.map((c: any) => c.text ?? "")
			.join("");
	}

	const approvals = output.filter((o: any) => o?.type === "mcp_approval_request");

	// A queued/in-progress background job has no output yet, surface id + status.
	if (!text && approvals.length === 0 && status && PENDING_STATUSES.has(status)) {
		const id = resp?.id ? `\nResponse id: ${resp.id}` : "";
		const detail = statusDetail(resp);
		return `${header}Agent run status: ${status}${detail ? ` (${detail})` : ""}.${id}\n\nPoll with agent_retrieve using this response id.`;
	}

	// Collect tool output items.
	let searchResults: any[] = [];
	const fetchedUrls: Array<{ title?: string; url?: string; snippet?: string }> = [];
	const images: any[] = [];
	const imageErrors: string[] = [];
	const mcpListings: any[] = [];
	const mcpCalls: any[] = [];
	const sharedFiles: any[] = [];
	for (const item of output) {
		switch (item?.type) {
			case "search_results":
				if (Array.isArray(item.results)) searchResults = searchResults.concat(item.results);
				break;
			case "fetch_url_results":
				for (const c of Array.isArray(item.contents) ? item.contents : []) {
					if (c && (c.url || c.title)) fetchedUrls.push({ title: c.title, url: c.url, snippet: c.snippet });
				}
				break;
			case "image_search_results":
				if (Array.isArray(item.results)) images.push(...item.results);
				if (item.error) imageErrors.push(String(item.error));
				break;
			case "mcp_list_tools":
				mcpListings.push(item);
				break;
			case "mcp_call":
				mcpCalls.push(item);
				break;
			case "share_file":
				sharedFiles.push(item);
				break;
		}
	}

	let statusLabel = "";
	if (status && status !== "completed") {
		const detail = statusDetail(resp);
		statusLabel = `[status: ${status}${detail ? `, ${detail}` : ""}]\n\n`;
	}

	const fallback = approvals.length > 0 ? "(awaiting MCP tool approval, see below)" : "(no text output)";
	let responseText = header + statusLabel + (text || fallback);
	if (resp?.id) responseText += `\n\n[response id: ${resp.id}]`;

	if (approvals.length > 0) {
		const lines = ["", "## MCP tool calls awaiting approval", ""];
		for (const a of approvals) {
			lines.push(`- ${a.server_label}.${a.name} (approval_request_id: ${a.id})`);
			if (a.arguments) lines.push(`  arguments: ${truncate(String(a.arguments), MAX_MCP_OUTPUT_CHARS)}`);
		}
		lines.push(
			"",
			"These calls did NOT run. To continue, call agent again with " +
				`previous_response_id: "${resp?.id ?? "<this response id>"}", ` +
				"approval_responses: [{ approval_request_id, approve: true|false, reason? }] for each, " +
				"and the SAME mcp_servers (tools are not carried over). 'input' may be empty."
		);
		responseText += "\n" + lines.join("\n");
	}

	responseText += renderSearchResults(searchResults);

	if (fetchedUrls.length > 0) {
		const fetchedLines = ["", "## Fetched URLs"];
		fetchedUrls.forEach((f, i) => {
			const title = f.title?.trim() || f.url || `Result ${i + 1}`;
			fetchedLines.push(f.url ? `${i + 1}. [${title}](${f.url})` : `${i + 1}. ${title}`);
			if (f.snippet?.trim()) fetchedLines.push(`   ${f.snippet.trim()}`);
		});
		responseText += "\n" + fetchedLines.join("\n");
	}

	if (images.length > 0 || imageErrors.length > 0) {
		const lines = ["", "## Images"];
		images.forEach((img, i) => {
			const title = img.title?.trim() || `Image ${i + 1}`;
			const dims = img.width && img.height ? ` (${img.width}x${img.height})` : "";
			lines.push(`${i + 1}. [${title}](${img.image_url})${dims}`);
			if (img.origin_url) lines.push(`   source: ${img.origin_url}`);
		});
		for (const e of imageErrors) lines.push(`(image search error: ${e})`);
		responseText += "\n" + lines.join("\n");
	}

	if (mcpListings.length > 0 || mcpCalls.length > 0) {
		const lines = ["", "## MCP activity"];
		for (const l of mcpListings) {
			const names = Array.isArray(l.tools) ? l.tools.map((t: any) => t?.name).filter(Boolean) : [];
			lines.push(
				l.error
					? `- ${l.server_label}: tool listing failed: ${l.error}`
					: `- ${l.server_label}: ${names.length} tool(s) available${names.length ? ` (${names.join(", ")})` : ""}`
			);
		}
		for (const c of mcpCalls) {
			lines.push(`- call ${c.server_label}.${c.name}(${truncate(String(c.arguments ?? ""), 200)})`);
			if (c.error) lines.push(`  error: ${c.error}`);
			else if (c.output) lines.push(`  output: ${truncate(String(c.output), MAX_MCP_OUTPUT_CHARS)}`);
		}
		responseText += "\n" + lines.join("\n");
	}

	if (sharedFiles.length > 0) {
		const lines = ["", "## Shared files"];
		for (const f of sharedFiles) {
			const label = f.filename ?? f.file_id ?? "file";
			if (f.error) {
				lines.push(`- ${label}: failed to share: ${f.error}`);
				continue;
			}
			const size = f.size_bytes !== undefined ? `, ${f.size_bytes} bytes` : "";
			lines.push(`- ${label}${size}${f.file_id ? ` (file_id: ${f.file_id})` : ""}`);
		}
		if (resp?.id) {
			lines.push("", `Download with agent_files { action: "content", response_id: "${resp.id}", file_id: "<file_id>" }`);
		}
		responseText += "\n" + lines.join("\n");
	}

	return responseText;
}

/**
 * structuredContent for `agent` / `agent_retrieve` (AGENT_RUN_OUTPUT_SCHEMA).
 * Mirrors what renderAgentResponse shows, minus the MCP activity trace.
 */
export function agentStructured(resp: any): Record<string, unknown> {
	const output: any[] = Array.isArray(resp?.output) ? resp.output : [];
	let text: string = typeof resp?.output_text === "string" ? resp.output_text : "";
	if (!text) {
		text = output
			.filter((o: any) => o?.type === "message")
			.flatMap((o: any) => (Array.isArray(o.content) ? o.content : []))
			.map((c: any) => (typeof c?.text === "string" ? c.text : ""))
			.join("");
	}
	const responseId = strOrNull(resp?.id);
	const of = (type: string) => output.filter((o: any) => o?.type === type);
	return {
		response_id: responseId,
		status: strOrNull(resp?.status),
		model: strOrNull(resp?.model),
		effort: strOrNull(resp?.effort ?? resp?.preset),
		service_tier: strOrNull(resp?.service_tier),
		output_text: text,
		status_detail: statusDetail(resp) || null,
		sources: toSources(of("search_results").flatMap((o: any) => (Array.isArray(o.results) ? o.results : []))),
		fetched_urls: of("fetch_url_results")
			.flatMap((o: any) => (Array.isArray(o.contents) ? o.contents : []))
			.filter((c: any) => c && (c.url || c.title))
			.map((c: any) => ({ title: strOrNull(c.title), url: strOrNull(c.url), snippet: strOrNull(c.snippet) })),
		images: of("image_search_results")
			.flatMap((o: any) => (Array.isArray(o.results) ? o.results : []))
			.filter((img: any) => strOrNull(img?.image_url))
			.map((img: any) => ({
				title: strOrNull(img.title),
				image_url: img.image_url,
				origin_url: strOrNull(img.origin_url),
				width: numOrNull(img.width),
				height: numOrNull(img.height),
			})),
		pending_approvals: of("mcp_approval_request")
			.filter((a: any) => strOrNull(a?.id))
			.map((a: any) => ({
				id: a.id,
				server_label: strOrNull(a.server_label),
				name: strOrNull(a.name),
				arguments: a.arguments === undefined || a.arguments === null ? null : String(a.arguments),
			})),
		shared_files: of("share_file").map((f: any) => {
			const fileId = strOrNull(f?.file_id);
			return {
				file_id: fileId,
				filename: strOrNull(f?.filename),
				size_bytes: numOrNull(f?.size_bytes),
				error: f?.error ? String(f.error) : null,
				uri: fileId && responseId ? agentFileUri(responseId, fileId) : null,
			};
		}),
		image_errors: of("image_search_results").filter((o: any) => o.error).map((o: any) => String(o.error)),
		mcp_activity: [
			...of("mcp_list_tools").map((l: any) => ({
				kind: "list_tools",
				server_label: strOrNull(l.server_label),
				name: null,
				tools: Array.isArray(l.tools) ? l.tools.map((t: any) => t?.name).filter((n: unknown) => typeof n === "string") : [],
				arguments: null,
				output: null,
				error: l.error ? String(l.error) : null,
			})),
			...of("mcp_call").map((c: any) => ({
				kind: "call",
				server_label: strOrNull(c.server_label),
				name: strOrNull(c.name),
				tools: [],
				arguments: c.arguments === undefined || c.arguments === null ? null : truncate(String(c.arguments), MAX_MCP_OUTPUT_CHARS),
				output: c.output === undefined || c.output === null ? null : truncate(String(c.output), MAX_MCP_OUTPUT_CHARS),
				error: c.error ? String(c.error) : null,
			})),
		],
		cost_usd: numOrNull(resp?.usage?.cost?.total_cost),
	};
}

/** Text + structuredContent for an Agent API response object. */
export function agentResult(resp: any) {
	return structuredResult(renderAgentResponse(resp), agentStructured(resp));
}

export class AgentHandler {
	constructor(private apiService: PerplexityApiService) {}

	async handle(request: McpRequest, ctx: HandlerContext = {}) {
		const invalid = agentArgsError(request.params.arguments);
		if (invalid) {
			throw ErrorHandler.validationError(`Invalid agent arguments: ${invalid}`);
		}

		const args = request.params.arguments as unknown as AgentArgs;

		try {
			const resp = await this.apiService.agentRespond(args, ctx);
			return agentResult(resp);
		} catch (error) {
			const enriched = await this.enrichIfModelError(error, args, ctx);
			if (enriched) return enriched;
			return ErrorHandler.handleApiError(error);
		}
	}

	/**
	 * On a rejected model/models value, appends the live catalog (filtered to the
	 * requested provider(s) when inferable) so the caller can retry immediately
	 * instead of needing a separate list_models round trip. Returns null when the
	 * error doesn't look model-related, or when fetching the catalog itself fails.
	 * Either way the caller falls back to the plain API error.
	 */
	private async enrichIfModelError(error: unknown, args: AgentArgs, ctx: HandlerContext) {
		if (!(error instanceof Error)) return null;
		const message = extractErrorMessage(error);
		if (!MODEL_ERROR_PATTERN.test(message)) return null;

		try {
			const response = await this.apiService.listModels(ctx);
			const models: ModelListEntry[] = Array.isArray(response?.data) ? response.data : [];
			if (models.length === 0) return null;

			const requested = [args.model, ...(args.models ?? [])].filter(
				(m): m is string => typeof m === "string" && m.length > 0
			);
			const requestedProviders = new Set(
				requested.map((m) => m.split("/")[0]?.toLowerCase()).filter(Boolean)
			);
			const filtered =
				requestedProviders.size > 0
					? models.filter((m) => requestedProviders.has((m.owned_by ?? "").toLowerCase()))
					: [];
			const pool = filtered.length > 0 ? filtered : models;

			const ids = pool.map((m) => m.id).sort();
			const scopeLabel = filtered.length > 0 ? " for the requested provider(s)" : "";
			const list = ids.map((id) => `- ${id}`).join("\n");

			return {
				content: [
					{
						type: "text",
						text: `Perplexity API error: ${message}\n\nCurrently valid model ids${scopeLabel} (${ids.length}):\n${list}\n\nRetry the agent call with one of these, or with an 'effort' level (e.g. 'low') instead of a model.`,
					},
				],
				isError: true,
			};
		} catch {
			return null;
		}
	}
}
