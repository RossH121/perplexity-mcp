/**
 * stderr-only logging. On the stdio transport stdout must carry nothing but
 * MCP JSON-RPC messages; the spec allows any UTF-8 logging on stderr.
 * Never use console.log in this codebase.
 */

export function logError(message: string, error?: unknown): void {
	const detail = error instanceof Error ? error.message : error === undefined ? "" : String(error);
	process.stderr.write(`[perplexity-mcp] ${message}${detail ? `: ${detail}` : ""}\n`);
}

/** Verbose diagnostics, only when PERPLEXITY_MCP_DEBUG is set. */
export function logDebug(message: string): void {
	if (process.env.PERPLEXITY_MCP_DEBUG) {
		process.stderr.write(`[perplexity-mcp] ${message}\n`);
	}
}
