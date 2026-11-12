/**
 * Helpers for tools that declare an outputSchema (src/schemas/outputSchemas.ts).
 * Every non-error result of such a tool goes through `structuredResult` so the
 * markdown text and the structuredContent are always sent together.
 */

export type StructuredToolResult = {
	content: Array<Record<string, unknown> & { type: string }>;
	structuredContent: Record<string, unknown>;
};

/** Markdown text block (plus any extra blocks) + structuredContent. */
export function structuredResult(
	text: string,
	data: Record<string, unknown>,
	extraBlocks: Array<Record<string, unknown> & { type: string }> = []
): StructuredToolResult {
	return { content: [{ type: "text", text }, ...extraBlocks], structuredContent: data };
}

// Coercers: API payloads are loosely typed, schemas are not. These keep a
// stray number-as-string or missing field from failing validation.

/** Non-empty string, else null. Numbers are stringified. */
export function strOrNull(v: unknown): string | null {
	if (typeof v === "string") return v.length > 0 ? v : null;
	if (typeof v === "number" && Number.isFinite(v)) return String(v);
	return null;
}

/** Finite number, else null. */
export function numOrNull(v: unknown): number | null {
	return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Integer, else null. */
export function intOrNull(v: unknown): number | null {
	return typeof v === "number" && Number.isInteger(v) ? v : null;
}

/** Search-result-ish record -> { title, url, date, last_updated, snippet }, or null without a url. */
export function toSource(r: any): Record<string, unknown> | null {
	const url = strOrNull(r?.url);
	if (!url) return null;
	return {
		title: strOrNull(r?.title),
		url,
		date: strOrNull(r?.date),
		last_updated: strOrNull(r?.last_updated),
		snippet: strOrNull(r?.snippet),
	};
}

export function toSources(list: unknown): Record<string, unknown>[] {
	return (Array.isArray(list) ? list : []).map(toSource).filter((s): s is Record<string, unknown> => s !== null);
}

/** Sonar/Agent image record -> { title, image_url, origin_url, width, height }; drops url-less ones. */
export function toImages(list: unknown): Record<string, unknown>[] {
	return (Array.isArray(list) ? list : [])
		.map((img: any): Record<string, unknown> | null => {
			const imageUrl = strOrNull(img?.image_url ?? img?.url);
			if (!imageUrl) return null;
			return {
				title: strOrNull(img?.title),
				image_url: imageUrl,
				origin_url: strOrNull(img?.origin_url),
				width: numOrNull(img?.width),
				height: numOrNull(img?.height),
			};
		})
		.filter((i): i is Record<string, unknown> => i !== null);
}
