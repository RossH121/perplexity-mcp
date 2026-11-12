/**
 * Translates Sonar-style `search` / `async_research_submit` arguments into an Agent
 * API (`client.responses.create`) request body.
 *
 * Sonar Chat Completions reached end of support on 2026-09-27; sync requests
 * are being reformulated onto the Agent API model by model. This builder does
 * that translation explicitly, per the official migration how-to
 * (docs.perplexity.ai/docs/agent-api/migrate-from-sonar/how-to), so behaviour
 * no longer changes silently underneath us. Anything with no Agent equivalent
 * is dropped and reported in `notes`, which the handler shows to the caller.
 *
 * Pure function: no network. Kept out of PerplexityApiService so tests can
 * exercise it directly and the service stays a thin transport layer.
 */

import { SearchArgs, AgentWebSearchOptions } from "../schemas/types.js";
import { buildWebSearchTool } from "../utils/agentRequest.js";
import {
	SONAR_TO_AGENT_EFFORT,
	AGENT_NO_SEARCH_MODEL,
	ACADEMIC_DOMAINS,
	SEC_DOMAINS,
	API_CONFIG,
} from "../config/constants.js";

export interface AgentSearchBuildOptions {
	/** Sonar model chosen by ModelSelectionService / set_model (ignored when args.effort is set). */
	sonarModel: string;
	query: string;
	/** Effective domain filter: per-call search_domain_filter, else the stateful domain_filter state (allow entries plain, block entries '-'-prefixed). */
	domainFilters?: string[];
	/** Effective recency (per-call `recency` already folded in by the caller). */
	recencyFilter?: string;
	args: Partial<SearchArgs>;
}

export interface AgentSearchRequest {
	body: Record<string, unknown>;
	/** Effort level requested (undefined when disable_search routes to a direct model). */
	effort?: string;
	/** Human-readable notes about params that were dropped or approximated. */
	notes: string[];
}

// image_search accepts only these formats; Sonar callers commonly passed 'jpg'.
const IMAGE_FORMATS = new Set(["bmp", "gif", "jpeg", "png", "webp", "svg"]);
// image_search.filters.domain_filter is capped at 10 entries.
const MAX_IMAGE_DOMAINS = 10;

/** Map a Sonar model id to its Agent effort level (unknown ids fall back to 'fast'). */
export function sonarModelToEffort(model: string): string {
	return SONAR_TO_AGENT_EFFORT[model] ?? "fast";
}

export function buildAgentSearchRequest(options: AgentSearchBuildOptions): AgentSearchRequest {
	const { sonarModel, query, domainFilters, recencyFilter, args } = options;
	const notes: string[] = [];
	const body: Record<string, unknown> = { input: query };

	// --- Params with no Agent API equivalent: dropped, but never silently. ---
	if (args.search_language_filter !== undefined) {
		notes.push("search_language_filter was ignored: the Agent API has no source-language filter.");
	}
	if (args.stream_mode !== undefined) {
		notes.push("stream_mode was ignored: the Agent API has no Pro Search stream modes.");
	}
	if (args.image_results_enhanced_relevance !== undefined) {
		notes.push("image_results_enhanced_relevance was ignored: the Agent API's image_search has no equivalent.");
	}
	if (args.return_related_questions) {
		notes.push("return_related_questions was ignored: the Agent API does not generate related questions.");
	}
	if (args.search_type === "auto") {
		notes.push("search_type 'auto' was ignored: the Agent API has no automatic tier; the model's mapped effort level was used.");
	}
	if (args.stop !== undefined) {
		notes.push("stop was ignored: the Agent API rejects stop sequences.");
	}
	if (args.enable_search_classifier !== undefined) {
		notes.push("enable_search_classifier was ignored: on the Agent API the model always decides when to search.");
	}

	// --- Shared generation controls. ---
	if (args.max_tokens !== undefined) body["max_output_tokens"] = args.max_tokens;
	if (args.temperature !== undefined) body["temperature"] = args.temperature;
	if (args.top_p !== undefined) body["top_p"] = args.top_p;
	if (args.language_preference !== undefined) body["language_preference"] = args.language_preference;
	if (args.response_format !== undefined) {
		// The Agent API requires json_schema.name; inject a default when omitted.
		const rf = args.response_format;
		body["response_format"] = rf.json_schema.name
			? rf
			: { ...rf, json_schema: { ...rf.json_schema, name: "response" } };
	}

	// disable_search: an effort level always pre-searches (tools:[] and
	// max_tool_calls:0 do not stop it), so route to a direct model with no tools.
	if (args.disable_search) {
		body["model"] = AGENT_NO_SEARCH_MODEL;
		if (args.reasoning_effort !== undefined) {
			notes.push("reasoning_effort was ignored because disable_search routes to a direct model.");
		}
		if (args.effort !== undefined) {
			notes.push(`effort '${args.effort}' was ignored because disable_search routes to a direct model.`);
		}
		notes.push(`disable_search: answered by ${AGENT_NO_SEARCH_MODEL} directly with no tools, so search filters do not apply.`);
		return { body, notes };
	}

	// --- Effort level: explicit per-call override, else from the Sonar model
	// adjusted by search_type. ---
	let effort = args.effort ?? sonarModelToEffort(sonarModel);
	if (args.effort !== undefined && args.search_type === "pro") {
		notes.push(`search_type 'pro' did not change the effort: the explicit effort '${args.effort}' was used.`);
	} else if (args.search_type === "pro" && effort === "fast") {
		// Official how-to: search_type "pro" -> effort "low".
		effort = "low";
	}
	body["effort"] = effort;
	if (args.reasoning_effort !== undefined) body["reasoning"] = { effort: args.reasoning_effort };

	// --- web_search tool: filters, location, context size. ---
	let domains = domainFilters && domainFilters.length > 0 ? [...domainFilters] : undefined;
	const tools: Array<Record<string, unknown>> = [];

	if (args.search_mode === "academic") {
		if (domains) {
			notes.push("search_mode 'academic' has no Agent equivalent; your domain filters were kept instead of the academic domain list.");
		} else {
			domains = [...ACADEMIC_DOMAINS];
			notes.push("search_mode 'academic' has no Agent equivalent; approximated with an allowlist of academic publisher and preprint domains.");
		}
	} else if (args.search_mode === "sec") {
		tools.push({ type: "finance_search" });
		if (domains) {
			notes.push("search_mode 'sec' mapped to the finance_search tool; your domain filters were kept for web_search.");
		} else {
			domains = [...SEC_DOMAINS];
			notes.push("search_mode 'sec' mapped to the finance_search tool plus a sec.gov domain filter on web_search.");
		}
	}

	// The Agent API 400s when search_recency_filter is combined with the
	// published-date filters (verified live 2026-11-12), so explicit dates win.
	const datesSet = args.search_after_date !== undefined || args.search_before_date !== undefined;
	if (recencyFilter && datesSet) {
		notes.push(`recency '${recencyFilter}' was ignored: the Agent API rejects it together with search_after_date/search_before_date, so the explicit dates were used.`);
	}
	const hasLocation =
		args.country !== undefined ||
		args.latitude !== undefined ||
		args.longitude !== undefined ||
		args.city !== undefined ||
		args.region !== undefined;
	const webSearch = buildWebSearchTool({
		search_domain_filter: domains ? domains.slice(0, API_CONFIG.MAX_DOMAINS) : undefined,
		search_recency_filter: recencyFilter && !datesSet ? (recencyFilter as AgentWebSearchOptions["search_recency_filter"]) : undefined,
		search_after_date_filter: args.search_after_date,
		search_before_date_filter: args.search_before_date,
		last_updated_after_filter: args.last_updated_after,
		last_updated_before_filter: args.last_updated_before,
		search_context_size: args.search_context_size,
		search_type: args.search_type === "fast" ? "fast" : undefined,
		user_location: hasLocation
			? {
					...(args.latitude !== undefined ? { latitude: args.latitude } : {}),
					...(args.longitude !== undefined ? { longitude: args.longitude } : {}),
					...(args.country !== undefined ? { country: args.country } : {}),
					...(args.city !== undefined ? { city: args.city } : {}),
					...(args.region !== undefined ? { region: args.region } : {}),
			  }
			: undefined,
	});

	// --- image_search tool for return_images. ---
	let imageSearch: Record<string, unknown> | undefined;
	if (args.return_images) {
		imageSearch = { type: "image_search" };
		const imageFilters: Record<string, unknown> = {};
		if (args.image_domain_filter && args.image_domain_filter.length > 0) {
			if (args.image_domain_filter.length > MAX_IMAGE_DOMAINS) {
				notes.push(`image_domain_filter was truncated to ${MAX_IMAGE_DOMAINS} domains (Agent image_search limit).`);
			}
			imageFilters["domain_filter"] = args.image_domain_filter.slice(0, MAX_IMAGE_DOMAINS);
		}
		if (args.image_format_filter && args.image_format_filter.length > 0) {
			const mapped = args.image_format_filter.map((f) => {
				const lower = f.toLowerCase();
				return lower === "jpg" ? "jpeg" : lower;
			});
			const kept = [...new Set(mapped.filter((f) => IMAGE_FORMATS.has(f)))];
			const dropped = mapped.filter((f) => !IMAGE_FORMATS.has(f));
			if (dropped.length > 0) {
				notes.push(`image_format_filter values ${dropped.join(", ")} were dropped (image_search accepts bmp, gif, jpeg, png, webp, svg).`);
			}
			if (kept.length > 0) imageFilters["format_filter"] = kept;
		}
		if (Object.keys(imageFilters).length > 0) imageSearch["filters"] = imageFilters;
	}

	// Only send `tools` when something needs configuring: the effort level
	// already brings its own web_search, and an explicit entry overrides that
	// tool's configuration with ours.
	const webSearchConfigured = Object.keys(webSearch).length > 1;
	if (webSearchConfigured || tools.length > 0 || imageSearch) {
		tools.unshift(webSearch);
		if (imageSearch) tools.push(imageSearch);
		body["tools"] = tools;
	}

	return { body, effort, notes };
}
