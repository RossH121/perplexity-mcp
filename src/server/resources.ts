/**
 * MCP resources for agent sandbox files (capability declared in capabilities.ts).
 *
 * - resources/templates/list: one template, perplexity-agent-file://{response_id}/{file_id}.
 * - resources/list: the files THIS server process has seen through agent_files
 *   (or a prior resources/read). It is not a server-side catalog: the API has
 *   no "list all files" endpoint, only per-run listing.
 * - resources/read: downloads via PerplexityApiService.getAgentFileContent with
 *   the same 5 MB cap as agent_files content. Text mime types come back as
 *   `text`, everything else as base64 `blob`.
 */

import { ProtocolError, ProtocolErrorCode, ResourceNotFoundError, type Server } from "@modelcontextprotocol/server";

import { PerplexityApiService } from "../services/PerplexityApiService.js";
import { AgentFileRegistry } from "../models/AgentFileRegistry.js";
import { FileTooLargeError, readAgentFileResource } from "../handlers/AgentFilesHandler.js";
import { AGENT_FILE_URI_TEMPLATE, parseAgentFileUri } from "../utils/agentFileUri.js";
import { extractErrorMessage } from "../utils/errorHandling.js";

/**
 * Resource misses throw ResourceNotFoundError. SDK v2 answers them with
 * -32602 (Invalid Params) on every protocol era, per the 2026-07-28 spec
 * MUST; v1 sent -32002. Clients should accept either.
 */

export function registerAgentFileResources(
	server: Server,
	apiService: PerplexityApiService,
	registry: AgentFileRegistry
) {
	server.setRequestHandler("resources/templates/list", async () => ({
		resourceTemplates: [
			{
				uriTemplate: AGENT_FILE_URI_TEMPLATE,
				name: "agent-file",
				title: "Perplexity agent sandbox file",
				description:
					"A file an agent run shared (office/* skills, share_file). Get ids from agent_files { action: \"list\", response_id }. Max 5 MB per read.",
			},
		],
	}));

	server.setRequestHandler("resources/list", async () => ({
		resources: registry.list().map((e) => ({
			uri: e.uri,
			name: e.filename ?? e.fileId,
			description: `Sandbox file from agent run ${e.responseId} (seen by this server session)`,
			...(e.mimeType ? { mimeType: e.mimeType } : {}),
			...(e.bytes !== undefined ? { size: e.bytes } : {}),
		})),
	}));

	server.setRequestHandler("resources/read", async (request, ctx) => {
		const { uri } = request.params;
		const parsed = parseAgentFileUri(uri);
		if (!parsed) {
			throw new ResourceNotFoundError(uri, `Resource not found: ${uri} (expected ${AGENT_FILE_URI_TEMPLATE})`);
		}
		try {
			const { contents, filename, bytes, contentType } = await readAgentFileResource(
				apiService,
				parsed.responseId,
				parsed.fileId,
				{ signal: ctx.mcpReq.signal }
			);
			registry.record(parsed.responseId, parsed.fileId, { filename, bytes, mimeType: contentType });
			return { contents: [contents] };
		} catch (error) {
			if (error instanceof FileTooLargeError) throw new ProtocolError(ProtocolErrorCode.InvalidRequest, error.message, { uri });
			const status = (error as { status?: unknown })?.status;
			if (status === 404 || status === 400) {
				throw new ResourceNotFoundError(uri, `Resource not found: ${uri} (${extractErrorMessage(error)})`);
			}
			throw new ProtocolError(ProtocolErrorCode.InternalError, `Perplexity API error: ${extractErrorMessage(error)}`, { uri });
		}
	});
}
