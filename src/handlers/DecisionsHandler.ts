/**
 * Handler for the decisions tool: Perplexity Decisions API (POST /v1/decisions,
 * client.decisions.create). Answers named noul (yes/no probability), choice
 * (pick an option) and score (ordered rubric) questions about `state`, with
 * optional web grounding. Returns calibrated probabilities, not prose: the API
 * returns no rationale, so the render is answers + evidence + usage.
 */

import { McpRequest, HandlerContext, DecisionsArgs } from "../schemas/types.js";
import { decisionsArgsError } from "../schemas/validation.js";
import { PerplexityApiService } from "../services/PerplexityApiService.js";
import { ErrorHandler } from "../utils/errorHandling.js";
import { formatUsd } from "../utils/formatUsd.js";
import { structuredResult, intOrNull, numOrNull, strOrNull, toSources } from "../utils/structuredResult.js";
import { DEFAULT_DECISION_MODEL } from "../config/constants.js";

// Input price per million tokens (output is free); per docs, 2026-11-12.
const FLASH_INPUT_PER_M = 0.01;
const FULL_INPUT_PER_M = 0.02;
// Each web search or successful URL fetch under mode:"web_grounding".
const TOOL_CALL_COST = 0.001;

const pct = (p: unknown): string =>
	typeof p === "number" && Number.isFinite(p) ? `${(p * 100).toFixed(1)}%` : "n/a";

const num = (n: unknown, digits = 2): string =>
	typeof n === "number" && Number.isFinite(n) ? n.toFixed(digits) : "n/a";

const asLabel = (v: unknown): string => (typeof v === "string" ? v : JSON.stringify(v));

function renderAnswer(name: string, answer: any): string[] {
	const out: string[] = [];
	switch (answer?.type) {
		case "noul":
			out.push(`- **${name}** (noul): P(yes) = ${pct(answer.noul)}`);
			break;
		case "choice": {
			out.push(`- **${name}** (choice): **${answer.choice}** (confidence ${num(answer.confidence)})`);
			const probs = Object.entries(answer.probabilities ?? {}).sort((a: any, b: any) => b[1] - a[1]);
			for (const [opt, p] of probs) out.push(`  - ${opt}: ${pct(p)}`);
			break;
		}
		case "score": {
			const legend = answer.legend ?? {};
			const probs = answer.probabilities ?? {};
			const top = Object.entries(probs).sort((a: any, b: any) => b[1] - a[1])[0]?.[0];
			const topLabel = top !== undefined && legend[top] !== undefined ? ` (most likely: ${top} = ${asLabel(legend[top])})` : "";
			out.push(`- **${name}** (score): ${num(answer.score)} of 0-${Math.max(0, Object.keys(legend).length - 1)}${topLabel}, confidence ${num(answer.confidence)}`);
			for (const level of Object.keys(legend).sort((a, b) => Number(a) - Number(b))) {
				out.push(`  - ${level} ${asLabel(legend[level])}: ${pct(probs[level])}`);
			}
			break;
		}
		default:
			out.push(`- **${name}**: ${JSON.stringify(answer)}`);
	}
	return out;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** One API answer -> the decisions outputSchema answer shape (known, well-typed fields only). */
function structuredAnswer(answer: any): Record<string, unknown> {
	const out: Record<string, unknown> = { type: typeof answer?.type === "string" ? answer.type : "unknown" };
	if (isNum(answer?.noul)) out.noul = answer.noul;
	if (typeof answer?.choice === "string") out.choice = answer.choice;
	if (isNum(answer?.score)) out.score = answer.score;
	if (isNum(answer?.confidence)) out.confidence = answer.confidence;
	if (answer?.probabilities && typeof answer.probabilities === "object") {
		out.probabilities = Object.fromEntries(
			Object.entries(answer.probabilities).filter((e): e is [string, number] => isNum(e[1]))
		);
	}
	if (answer?.legend && typeof answer.legend === "object" && !Array.isArray(answer.legend)) out.legend = answer.legend;
	return out;
}

export function estimateDecisionCost(model: string, usage: any): number | undefined {
	if (typeof usage?.input_tokens !== "number") return undefined;
	const rate = /flash/i.test(model) ? FLASH_INPUT_PER_M : FULL_INPUT_PER_M;
	const details = usage.tool_calls_details ?? {};
	const toolCalls = Object.values(details).reduce(
		(n: number, d: any) => n + (typeof d?.invocation === "number" ? d.invocation : 0),
		0
	);
	return (usage.input_tokens * rate) / 1e6 + toolCalls * TOOL_CALL_COST;
}

export class DecisionsHandler {
	constructor(private apiService: PerplexityApiService) {}

	async handle(request: McpRequest, ctx: HandlerContext = {}) {
		const problem = decisionsArgsError(request.params.arguments);
		if (problem) throw ErrorHandler.validationError(`Invalid decisions arguments. ${problem}`);

		const args = request.params.arguments as unknown as DecisionsArgs;

		try {
			const resp = await this.apiService.createDecision(args, ctx);
			const model = resp?.model ?? args.model ?? DEFAULT_DECISION_MODEL;
			const lines: string[] = ["## Decisions", `Model: ${model}`, ""];

			const answers = resp?.answers ?? {};
			for (const name of Object.keys(args.questions)) {
				if (answers[name] !== undefined) lines.push(...renderAnswer(name, answers[name]));
				else lines.push(`- **${name}**: (no answer returned)`);
			}
			for (const name of Object.keys(answers)) {
				if (!(name in args.questions)) lines.push(...renderAnswer(name, answers[name]));
			}

			const fetched: any[] = resp?.fetched_results ?? [];
			if (fetched.length > 0) {
				lines.push("", "### Fetched page");
				for (const f of fetched) {
					lines.push(`- [${f.title || f.url}](${f.url}) (${f.snippet?.length ?? 0} chars of text used as state)`);
				}
			}
			const sources: any[] = resp?.search_results ?? [];
			if (sources.length > 0) {
				lines.push("", "### Sources");
				sources.forEach((s, i) => {
					const date = s.date ? ` (${s.date})` : "";
					lines.push(`${i + 1}. [${s.title || s.url}](${s.url})${date}`);
				});
			} else if (args.mode === "web_grounding") {
				lines.push("", "_Web grounding found no search evidence; answered from `state` only._");
			}

			const usage = resp?.usage;
			if (usage) {
				const parts = [`${usage.input_tokens ?? "?"} input tokens`];
				for (const [tool, d] of Object.entries<any>(usage.tool_calls_details ?? {})) {
					if (typeof d?.invocation === "number") parts.push(`${d.invocation} ${tool}`);
				}
				const est = estimateDecisionCost(model, usage);
				const cost = est !== undefined ? `, est. cost ${formatUsd(est)}` : "";
				lines.push("", `_Usage: ${parts.join(", ")}${cost}_`);
			}

			const toolCalls: Record<string, number> = {};
			for (const [tool, d] of Object.entries<any>(usage?.tool_calls_details ?? {})) {
				if (Number.isInteger(d?.invocation)) toolCalls[tool] = d.invocation;
			}
			return structuredResult(lines.join("\n"), {
				model,
				answers: Object.fromEntries(Object.entries<any>(answers).map(([k, v]) => [k, structuredAnswer(v)])),
				missing_answers: Object.keys(args.questions).filter((name) => answers[name] === undefined),
				usage: {
					input_tokens: intOrNull(usage?.input_tokens),
					output_tokens: intOrNull(usage?.output_tokens),
					tool_calls: toolCalls,
				},
				estimated_cost_usd: usage ? numOrNull(estimateDecisionCost(model, usage)) : null,
				search_results: toSources(sources).map(({ snippet: _drop, ...rest }) => rest),
				fetched_results: fetched
					.filter((f) => strOrNull(f?.url))
					.map((f) => ({ title: strOrNull(f.title), url: f.url, chars: typeof f.snippet === "string" ? f.snippet.length : 0 })),
			});
		} catch (error) {
			return ErrorHandler.handleApiError(error);
		}
	}
}
