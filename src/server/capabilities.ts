/**
 * MCP server capabilities declaration
 */

export const SERVER_CAPABILITIES = {
	tools: {},
	// agent_files sandbox files: template perplexity-agent-file://{response_id}/{file_id}.
	// resources/list = files seen in this process; listChanged fires when it grows.
	resources: { listChanged: true },
} as const;