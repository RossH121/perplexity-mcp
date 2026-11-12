/**
 * URIs for files an agent run shared (agent_files / resources/read).
 * Template: perplexity-agent-file://{response_id}/{file_id}
 */

export const AGENT_FILE_URI_SCHEME = "perplexity-agent-file:";
export const AGENT_FILE_URI_TEMPLATE = "perplexity-agent-file://{response_id}/{file_id}";

export function agentFileUri(responseId: string, fileId: string): string {
	return `perplexity-agent-file://${encodeURIComponent(responseId)}/${encodeURIComponent(fileId)}`;
}

/** Parse an agent-file URI, or null when it is not one (wrong scheme, missing parts, extra segments). */
export function parseAgentFileUri(uri: string): { responseId: string; fileId: string } | null {
	const m = /^perplexity-agent-file:\/\/([^/?#]+)\/([^/?#]+)$/.exec(uri);
	if (!m) return null;
	try {
		const responseId = decodeURIComponent(m[1]);
		const fileId = decodeURIComponent(m[2]);
		return responseId && fileId ? { responseId, fileId } : null;
	} catch {
		return null;
	}
}
