/**
 * MCP-compliant error handling utilities
 *
 * Error contract (MCP 2025-11-25 "Tool Execution Errors"):
 * - Bad tool input and Perplexity API failures are tool *results* with
 *   `isError: true`, so the model sees the message and can self-correct.
 *   Handlers either return `ErrorHandler.handleApiError(...)` or throw; the
 *   server's CallTool dispatcher turns anything thrown into an isError result
 *   via `ErrorHandler.toToolResult`.
 * - Only protocol-level problems (unknown tool name) are thrown as ProtocolError
 *   (SDK v2; was McpError in v1).
 */

export type ErrorResponse = { content: Array<{ type: "text"; text: string }>; isError: true };

/**
 * Thrown by handlers when tool arguments fail validation. The dispatcher
 * renders its message verbatim as an isError tool result.
 */
export class ToolInputError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ToolInputError";
	}
}

export function extractErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		// Perplexity SDK errors expose a .message and sometimes .body
		const e = error as Error & { body?: { error?: { message?: string }; detail?: string }; status?: number };
		return e.body?.error?.message || e.body?.detail || e.message;
	}
	return "Unknown error";
}

export function toolErrorResult(text: string): ErrorResponse {
	return { content: [{ type: "text", text }], isError: true };
}

export class ErrorHandler {
	/** Build the error a handler throws for invalid arguments. */
	static validationError(message: string): ToolInputError {
		return new ToolInputError(message);
	}

	static handleApiError(error: unknown): ErrorResponse {
		return toolErrorResult(`Perplexity API error: ${extractErrorMessage(error)}`);
	}

	static handleStreamingApiError(error: unknown): ErrorResponse {
		return toolErrorResult(`Perplexity API streaming error: ${extractErrorMessage(error)}`);
	}

	/**
	 * Convert anything a handler threw into an isError tool result. Validation
	 * errors pass through verbatim; SDK API errors (they carry an HTTP status)
	 * get the "Perplexity API error" prefix; anything else is a generic error.
	 */
	static toToolResult(error: unknown): ErrorResponse {
		if (error instanceof ToolInputError) return toolErrorResult(error.message);
		if (error instanceof Error && typeof (error as { status?: unknown }).status === "number") {
			return ErrorHandler.handleApiError(error);
		}
		return toolErrorResult(`Error: ${extractErrorMessage(error)}`);
	}
}
