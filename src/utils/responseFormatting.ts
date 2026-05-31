/**
 * Shared rendering helpers for turning Perplexity responses into MCP text output.
 */

import { SearchResultItem, Usage, ResponseImage } from "../schemas/types.js";

/**
 * Normalize an SDK message `content` value (typed `string | ContentChunk[] | null`)
 * into a plain string. null/undefined → ""; an array of content parts → the
 * concatenation of their `.text` fields; a string → itself.
 */
export function normalizeMessageContent(content: unknown): string {
	if (content === null || content === undefined) return "";
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((part) =>
				part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
					? (part as { text: string }).text
					: ""
			)
			.join("");
	}
	return "";
}

/** Strip <think>...</think> reasoning blocks (sonar-reasoning-pro / deep-research). */
export function stripThinkingBlocks(text: string): string {
	return text.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();
}

/** Render a numbered Sources section from search_results. Returns "" when empty. */
export function renderSearchResults(results?: SearchResultItem[]): string {
	if (!results || results.length === 0) return "";
	let out = "\n\n## Sources\n";
	results.forEach((result, index) => {
		const dateInfo = result.date ? ` (${result.date})` : "";
		out += `[${index + 1}] ${result.title}${dateInfo}\n${result.url}\n\n`;
	});
	return out;
}

/** Render an Images section from a response images array. Returns "" when empty. */
export function renderImages(images?: ResponseImage[]): string {
	if (!images || images.length === 0) return "";
	let out = "\n\n## Images\n";
	images.forEach((img, index) => {
		const url = img.image_url || img.url || img.origin_url;
		if (url) out += `[${index + 1}] ${url}\n`;
	});
	return out;
}

/** Render a Related Questions section. Returns "" when empty. */
export function renderRelatedQuestions(questions?: string[]): string {
	if (!questions || questions.length === 0) return "";
	let out = "\n\n## Related Questions\n";
	questions.forEach((q) => {
		out += `- ${q}\n`;
	});
	return out;
}

/** Render a one-line cost footer from usage.cost when present and requested. */
export function renderCostFooter(usage?: Usage): string {
	const total = usage?.cost?.total_cost;
	if (total === undefined || total === null) return "";
	return `\n\n_Request cost: $${total.toFixed(6)}_`;
}

/**
 * Render the trailing extras (Sources, Images, Related Questions, and an optional
 * cost footer) for a search-style response, in the canonical output order.
 */
export function renderResponseExtras(
	result: {
		search_results?: SearchResultItem[];
		images?: ResponseImage[];
		related_questions?: string[];
		usage?: Usage;
	},
	showCost: boolean
): string {
	let out = "";
	out += renderSearchResults(result.search_results);
	out += renderImages(result.images);
	out += renderRelatedQuestions(result.related_questions);
	if (showCost) out += renderCostFooter(result.usage);
	return out;
}
