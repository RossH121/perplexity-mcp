/**
 * MCP-compliant error handling utilities
 */

import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

type ErrorResponse = { content: Array<{ type: string; text: string }>; isError: boolean };

function extractErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		// Perplexity SDK errors expose a .message and sometimes .body
		const e = error as Error & { body?: { error?: { message?: string }; detail?: string }; status?: number };
		return e.body?.error?.message || e.body?.detail || e.message;
	}
	return "Unknown error";
}

export class ErrorHandler {
	static createMcpError(code: ErrorCode, message: string): McpError {
		return new McpError(code, message);
	}

	static handleValidationError(message: string): McpError {
		return new McpError(ErrorCode.InvalidParams, message);
	}

	static handleApiError(error: unknown): ErrorResponse {
		return {
			content: [{ type: "text", text: `Perplexity API error: ${extractErrorMessage(error)}` }],
			isError: true,
		};
	}

	static handleStreamingApiError(error: unknown): ErrorResponse {
		return {
			content: [{ type: "text", text: `Perplexity API streaming error: ${extractErrorMessage(error)}` }],
			isError: true,
		};
	}
}
