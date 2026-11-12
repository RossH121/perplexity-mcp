/**
 * Handler for the agent_files tool, list / retrieve files a sandbox tool
 * call produced during an agent run (client.responses.files.list/.content).
 *
 * Files are also MCP resources: perplexity-agent-file://{response_id}/{file_id}
 * (template served by PerplexityMcpServer, read via `readAgentFileResource`).
 * - list    -> text + one `resource_link` block per file + structuredContent.
 * - content -> text + an embedded `resource` block carrying the bytes. Kept
 *   embedded (not a resource_link) on purpose: Claude Code inlines small PDFs
 *   as documents and images as images, and saves other binaries to a file it
 *   hands the model, all in one call. A resource_link would only render as
 *   "[Resource link: name] uri" and cost a second ReadMcpResource round trip.
 */

import { McpRequest, HandlerContext, AgentFilesArgs } from "../schemas/types.js";
import { isValidAgentFilesArgs } from "../schemas/validation.js";
import { PerplexityApiService } from "../services/PerplexityApiService.js";
import { AgentFileRegistry } from "../models/AgentFileRegistry.js";
import { ErrorHandler } from "../utils/errorHandling.js";
import { agentFileUri } from "../utils/agentFileUri.js";
import { numOrNull, strOrNull, structuredResult } from "../utils/structuredResult.js";

// Transport-friendly cap on inlined file content. Sandbox outputs can be
// arbitrarily large; base64-encoding a huge file into a JSON-RPC message would
// bloat both the wire payload and the model's context window. Applies to both
// agent_files content and resources/read.
export const MAX_INLINE_BYTES = 5 * 1024 * 1024; // 5 MB

const TEXTUAL_MIME = /^(text\/|application\/(json|xml|csv|x-yaml|yaml|javascript|x-ndjson)\b)|\+(json|xml)\b/i;

/** Thrown when a file is over MAX_INLINE_BYTES. */
export class FileTooLargeError extends Error {
	constructor(label: string, bytes: number) {
		const mb = (bytes / (1024 * 1024)).toFixed(1);
		super(`File ${label} is ${mb} MB, over the ${MAX_INLINE_BYTES / (1024 * 1024)} MB limit for inlining into a response. Not retrieved.`);
		this.name = "FileTooLargeError";
	}
}

/**
 * Download one file and shape it as MCP resource contents: `text` for
 * UTF-8 textual mime types, else base64 `blob`. Throws FileTooLargeError over
 * the cap, and lets SDK API errors propagate.
 */
export async function readAgentFileResource(
	apiService: PerplexityApiService,
	responseId: string,
	fileId: string,
	ctx: HandlerContext = {}
) {
	const { buffer, contentType, filename } = await apiService.getAgentFileContent(fileId, responseId, ctx);
	if (buffer.byteLength > MAX_INLINE_BYTES) throw new FileTooLargeError(filename ?? fileId, buffer.byteLength);

	const uri = agentFileUri(responseId, fileId);
	// Exactly one of text/blob (the MCP TextResourceContents | BlobResourceContents union).
	let contents: { uri: string; mimeType: string; text: string } | { uri: string; mimeType: string; blob: string } = {
		uri,
		mimeType: contentType,
		blob: buffer.toString("base64"),
	};
	if (TEXTUAL_MIME.test(contentType)) {
		try {
			contents = { uri, mimeType: contentType, text: new TextDecoder("utf-8", { fatal: true }).decode(buffer) };
		} catch {
			// Not valid UTF-8 despite the mime type: keep the blob.
		}
	}
	return { contents, filename, bytes: buffer.byteLength, contentType };
}

export class AgentFilesHandler {
	constructor(
		private apiService: PerplexityApiService,
		private registry: AgentFileRegistry = new AgentFileRegistry()
	) {}

	async handle(request: McpRequest, ctx: HandlerContext = {}) {
		if (!isValidAgentFilesArgs(request.params.arguments)) {
			throw ErrorHandler.validationError(
				"Invalid agent_files arguments. 'action' must be 'list' or 'content'; both require 'response_id', 'content' also requires 'file_id'."
			);
		}

		const args = request.params.arguments as AgentFilesArgs;

		try {
			return args.action === "list" ? await this.list(args, ctx) : await this.content(args, ctx);
		} catch (error) {
			if (error instanceof FileTooLargeError) return ErrorHandler.toToolResult(ErrorHandler.validationError(error.message));
			return ErrorHandler.handleApiError(error);
		}
	}

	private async list(args: AgentFilesArgs, ctx: HandlerContext) {
		const result = await this.apiService.listAgentFiles(args.response_id, ctx);
		const files: any[] = (Array.isArray(result?.data) ? result.data : []).filter((f: any) => strOrNull(f?.id));

		const entries = files.map((f) => {
			const fileId = String(f.id);
			const filename = strOrNull(f.filename);
			const bytes = numOrNull(f.bytes);
			const uri = this.registry.record(args.response_id, fileId, {
				filename: filename ?? undefined,
				bytes: bytes ?? undefined,
			});
			return { file_id: fileId, filename, bytes, uri };
		});
		const data = { action: "list", response_id: args.response_id, files: entries };

		if (entries.length === 0) {
			return structuredResult("No files were produced by this agent run.", data);
		}

		const lines = ["## Sandbox files", ""];
		entries.forEach((f) => {
			lines.push(`- ${f.filename ?? f.file_id}, ${f.bytes ?? "?"} bytes (id: ${f.file_id})`);
		});
		lines.push(
			"",
			`Retrieve one with: agent_files { action: "content", response_id: "${args.response_id}", file_id: "<id>" }, or read its resource URI.`
		);
		const links = entries.map((f) => ({
			type: "resource_link",
			uri: f.uri,
			name: f.filename ?? f.file_id,
			...(f.bytes !== null ? { size: f.bytes } : {}),
			description: `Sandbox file from agent run ${args.response_id}`,
		}));
		return structuredResult(lines.join("\n"), data, links);
	}

	private async content(args: AgentFilesArgs, ctx: HandlerContext) {
		const fileId = args.file_id as string;
		const { contents, filename, bytes, contentType } = await readAgentFileResource(
			this.apiService,
			args.response_id,
			fileId,
			ctx
		);
		this.registry.record(args.response_id, fileId, { filename, bytes, mimeType: contentType });
		const label = filename ?? fileId;

		const result = structuredResult(
			`Retrieved ${label} (${bytes} bytes, ${contentType}). Resource URI: ${contents.uri}`,
			{
				action: "content",
				response_id: args.response_id,
				file: { file_id: fileId, filename: filename ?? null, bytes, mime_type: contentType, uri: contents.uri },
			}
		);
		// Resource block first (as before), then the text summary.
		result.content.unshift({ type: "resource", resource: contents });
		return result;
	}
}
