/**
 * Handlers for async research jobs: async_research_submit (write, billed),
 * async_research_status and async_research_list (read-only), plus the
 * DEPRECATED combined `async_research` tool (action submit|status|list), kept
 * as an alias for one release and dispatching to the same code.
 *
 * DEPRECATED in favour of `agent` with background:true + `agent_retrieve`.
 * Kept (same name, same action enum) for existing callers, rebuilt on the
 * Agent API's background mode because Perplexity ended support for async Sonar
 * on 2026-09-27 ("not reformulated and no longer supported").
 *
 * - submit: responses.create({ background:true, effort: mapped(model) }) on the
 *   agent backend (default); the legacy async Sonar endpoint when
 *   PERPLEXITY_SEARCH_BACKEND=sonar.
 * - status: ids with the Agent "resp_" prefix go to responses.retrieve; any
 *   other id (legacy async ids are bare UUIDs) goes to the legacy
 *   async.chat.completions.get, for as long as that endpoint answers.
 * - list: the Agent API has no list endpoint, so this returns the ids submitted
 *   in this server process (in-memory, lost on restart) plus, best effort, the
 *   legacy async job list.
 */

import { McpRequest, HandlerContext, AsyncResearchArgs, SearchArgs } from "../schemas/types.js";
import {
	isValidAsyncResearchArgs,
	isValidAsyncResearchSubmitArgs,
	isValidAsyncResearchStatusArgs,
} from "../schemas/validation.js";
import { PerplexityApiService } from "../services/PerplexityApiService.js";
import { buildAgentSearchRequest } from "../services/agentSearchRequest.js";
import { ErrorHandler, extractErrorMessage } from "../utils/errorHandling.js";
import { structuredResult, strOrNull, toSources } from "../utils/structuredResult.js";
import { resolveSearchBackend } from "../config/constants.js";
import {
	stripThinkingBlocks,
	renderSearchResults,
	extractAgentOutput,
	renderAgentSources,
	renderBackendNotes,
} from "../utils/responseFormatting.js";

const DEFAULT_ASYNC_MODEL = "sonar-deep-research";
const AGENT_ID_PREFIX = "resp_";
const PENDING_AGENT_STATUSES = new Set(["queued", "in_progress"]);

interface RegistryEntry {
	query: string;
	model: string;
	effort?: string;
	submittedAt: string;
	lastStatus: string;
	notes: string[];
}

export class AsyncResearchHandler {
	// Ids submitted through this server process. Not persisted.
	private registry = new Map<string, RegistryEntry>();

	constructor(private apiService: PerplexityApiService) {}

	/** async_research_submit: start a billed background research job. */
	async handleSubmit(request: McpRequest, ctx: HandlerContext = {}) {
		if (!isValidAsyncResearchSubmitArgs(request.params.arguments)) {
			throw ErrorHandler.validationError(
				"Invalid async_research_submit arguments. 'query' must be a non-empty string; model, reasoning_effort and search_mode must be valid values."
			);
		}
		return this.dispatch({ ...(request.params.arguments as AsyncResearchArgs), action: "submit" }, ctx);
	}

	/** async_research_status: poll one job. Read-only. */
	async handleStatus(request: McpRequest, ctx: HandlerContext = {}) {
		if (!isValidAsyncResearchStatusArgs(request.params.arguments)) {
			throw ErrorHandler.validationError(
				"Invalid async_research_status arguments. 'request_id' must be a non-empty string."
			);
		}
		return this.dispatch({ ...(request.params.arguments as AsyncResearchArgs), action: "status" }, ctx);
	}

	/** async_research_list: ids from this process plus legacy jobs. Read-only. */
	async handleList(_request?: McpRequest, ctx: HandlerContext = {}) {
		return this.dispatch({ action: "list" }, ctx);
	}

	/** DEPRECATED combined async_research tool. */
	async handle(request: McpRequest, ctx: HandlerContext = {}) {
		if (!isValidAsyncResearchArgs(request.params.arguments)) {
			throw ErrorHandler.validationError(
				"Invalid async_research arguments. 'action' must be submit|status|list; submit requires 'query', status requires 'request_id'."
			);
		}
		const result: any = await this.dispatch(request.params.arguments as AsyncResearchArgs, ctx);
		if (!result?.isError && result?.content?.[0]?.type === "text") {
			result.content[0].text +=
				"\n\nNote: async_research is deprecated; use async_research_submit, async_research_status and async_research_list.";
		}
		return result;
	}

	private async dispatch(args: AsyncResearchArgs, ctx: HandlerContext) {
		const backend = resolveSearchBackend();
		if (args.action === "submit" && backend === "sonar" && args.model !== undefined && args.model !== DEFAULT_ASYNC_MODEL) {
			// The live async endpoint 400s for anything else ("Async processing is
			// only available for sonar-deep-research", verified 2026-11-12).
			throw ErrorHandler.validationError(
				"Invalid async_research arguments. On the legacy Sonar backend only model 'sonar-deep-research' is supported."
			);
		}

		try {
			switch (args.action) {
				case "submit":
					return backend === "sonar"
						? await this.submitLegacy(args, ctx)
						: await this.submitAgent(args, ctx);
				case "status":
					return args.request_id!.startsWith(AGENT_ID_PREFIX)
						? await this.statusAgent(args, ctx)
						: await this.statusLegacy(args, ctx);
				case "list":
					return await this.list(ctx);
			}
		} catch (error) {
			return ErrorHandler.handleApiError(error);
		}
	}

	private async submitAgent(args: AsyncResearchArgs, ctx: HandlerContext) {
		const model = args.model ?? DEFAULT_ASYNC_MODEL;
		const { body, effort, notes } = buildAgentSearchRequest({
			sonarModel: model,
			query: args.query as string,
			args: { reasoning_effort: args.reasoning_effort, search_mode: args.search_mode },
		});
		body["background"] = true;

		const job = await this.apiService.agentSearch(body, ctx);
		const status: string = job?.status ?? "queued";
		if (job?.id) {
			this.registry.set(job.id, {
				query: args.query as string,
				model,
				effort,
				submittedAt: new Date().toISOString(),
				lastStatus: status,
				notes,
			});
		}

		const lines = [
			"## Async research job submitted",
			`Request ID: ${job?.id}`,
			`Status: ${status}`,
			`Backend: Agent API background run (${model} -> effort ${effort})`,
			"",
			`Poll with: async_research_status { request_id: "${job?.id}" }`,
			"The same id also works with agent_retrieve, and agent_cancel can stop it.",
		];
		return { content: [{ type: "text", text: lines.join("\n") + renderBackendNotes(notes) }] };
	}

	private async submitLegacy(args: AsyncResearchArgs, ctx: HandlerContext) {
		const apiParams = this.apiService.createApiParams({
			model: DEFAULT_ASYNC_MODEL,
			query: args.query as string,
			args: {
				query: args.query,
				reasoning_effort: args.reasoning_effort,
				search_mode: args.search_mode,
			} as SearchArgs,
			systemPrompt: "You are a helpful assistant that performs thorough web research.",
		});

		const job = await this.apiService.submitAsyncResearch(apiParams, ctx);
		const lines = [
			"## Async research job submitted",
			`Request ID: ${job.id}`,
			`Status: ${job.status}`,
			"Backend: legacy async Sonar (unsupported by Perplexity since 2026-09-27; may stop without notice)",
			"",
			`Poll with: async_research_status { request_id: "${job.id}" }`,
			"Jobs expire 7 days after creation.",
		];
		return { content: [{ type: "text", text: lines.join("\n") }] };
	}

	private async statusAgent(args: AsyncResearchArgs, ctx: HandlerContext) {
		const id = args.request_id as string;
		const resp = await this.apiService.getAgentResponse(id, ctx);
		const status: string = resp?.status ?? "unknown";
		const entry = this.registry.get(id);
		if (entry) entry.lastStatus = status;
		const header = `## Job ${resp?.id ?? id}\nStatus: ${status}`;
		const base = { request_id: strOrNull(resp?.id) ?? id, backend: "agent", status, output_text: "", sources: [], error: null, notes: [...(entry?.notes ?? [])].map(String) };

		if (PENDING_AGENT_STATUSES.has(status)) {
			const paused = resp?.paused ? `\nPaused: ${JSON.stringify(resp.paused)}` : "";
			return structuredResult(`${header}${paused}\n\n(Not ready yet, poll again.)`, {
				...base,
				done: false,
				status_detail: resp?.paused ? `paused: ${JSON.stringify(resp.paused)}` : null,
			});
		}

		if (status === "failed") {
			const message = resp?.error?.message ?? "(no error message provided)";
			return structuredResult(`${header}\n\nThis job failed and will not produce a result.\nError: ${message}`, {
				...base,
				done: true,
				error: String(message),
			});
		}

		const { text: rawText, searchResults } = extractAgentOutput(resp);
		const content = args.strip_thinking ? stripThinkingBlocks(rawText) : rawText;
		let text = header;
		if (status !== "completed") {
			const detail = resp?.incomplete_details?.reason ?? resp?.error?.message;
			text += `\n\nThis job ended as '${status}'${detail ? ` (${detail})` : ""}. Any partial output follows.`;
		}
		text += `\n\n${content || "(no text output)"}`;
		text += renderAgentSources(searchResults);
		text += renderBackendNotes(entry?.notes ?? []);
		return structuredResult(text, {
			...base,
			done: true,
			output_text: content,
			sources: toSources(searchResults),
			status_detail: strOrNull(resp?.incomplete_details?.reason ?? resp?.error?.message),
		});
	}

	private async statusLegacy(args: AsyncResearchArgs, ctx: HandlerContext) {
		const job = await this.apiService.getAsyncResearch(args.request_id as string, ctx);
		const header = `## Job ${job.id}\nStatus: ${job.status}`;
		const base = {
			request_id: strOrNull(job?.id) ?? (args.request_id as string),
			backend: "legacy",
			status: strOrNull(job?.status) ?? "unknown",
			output_text: "",
			sources: [],
			error: strOrNull(job?.error_message),
			notes: [] as string[],
		};

		if (job.status === "FAILED") {
			let text = `${header}\n\nThis job failed and will not produce a result.`;
			text += `\nError: ${job.error_message ?? "(no error message provided)"}`;
			if (job.failed_at) text += `\nFailed at: ${job.failed_at}`;
			return structuredResult(text, { ...base, done: true, error: base.error ?? "(no error message provided)" });
		}

		if (job.status !== "COMPLETED" || !job.response) {
			const extra = job.error_message ? `\nError: ${job.error_message}` : "";
			return structuredResult(`${header}${extra}\n\n(Not ready yet, poll again.)`, { ...base, done: false });
		}

		const resp = job.response;
		let content = resp?.choices?.[0]?.message?.content ?? "";
		if (args.strip_thinking) content = stripThinkingBlocks(content);

		let text = `${header}\n\n${content}`;
		text += renderSearchResults(resp?.search_results);
		return structuredResult(text, { ...base, done: true, output_text: content, sources: toSources(resp?.search_results) });
	}

	private async list(ctx: HandlerContext) {
		const lines = ["## Async research jobs", ""];

		lines.push("### Submitted in this server process (Agent API background runs)");
		if (this.registry.size === 0) {
			lines.push("(none)");
		} else {
			for (const [id, e] of this.registry) {
				const q = e.query.length > 80 ? `${e.query.slice(0, 77)}...` : e.query;
				lines.push(`- ${id}: ${e.lastStatus} (${e.model} -> effort ${e.effort}, submitted ${e.submittedAt}) "${q}"`);
			}
		}
		lines.push(
			"",
			"Note: the Agent API has no endpoint to list runs. This registry lives in server memory and is lost on restart, so keep the ids you need."
		);

		const data = {
			jobs: [...this.registry].map(([id, e]) => ({
				request_id: id,
				status: String(e.lastStatus),
				model: strOrNull(e.model),
				effort: strOrNull(e.effort),
				submitted_at: strOrNull(e.submittedAt),
				query: strOrNull(e.query),
			})),
			legacy_jobs: [] as Array<Record<string, unknown>>,
			legacy_error: null as string | null,
		};

		// Legacy async jobs, best effort: the endpoint is unsupported and may vanish.
		try {
			const result = await this.apiService.listAsyncResearch(ctx);
			const jobs = result?.requests ?? result?.data ?? [];
			if (Array.isArray(jobs)) {
				data.legacy_jobs = jobs
					.filter((j: any) => strOrNull(j?.id))
					.map((j: any) => ({ request_id: String(j.id), status: strOrNull(j.status), model: strOrNull(j.model) }));
			}
			if (Array.isArray(jobs) && jobs.length > 0) {
				lines.push("", "### Legacy async Sonar jobs");
				jobs.forEach((j: any) => {
					lines.push(`- ${j.id}: ${j.status}${j.model ? ` (${j.model})` : ""}`);
				});
			}
		} catch (error) {
			lines.push("", `(Legacy async job list unavailable: ${extractErrorMessage(error)})`);
			data.legacy_error = extractErrorMessage(error);
		}

		return structuredResult(lines.join("\n"), data);
	}
}
