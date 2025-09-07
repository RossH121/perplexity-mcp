/**
 * MCP-compliant error handling utilities
 */

import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";

export class ErrorHandler {
	/**
	 * Creates an MCP-compliant error response
	 */
	static createMcpError(code: ErrorCode, message: string): McpError {
		return new McpError(code, message);
	}

	/**
	 * Handles validation errors
	 */
	static handleValidationError(message: string): McpError {
		return new McpError(ErrorCode.InvalidParams, message);
	}

	/**
	 * Handles API errors from Perplexity
	 */
	static handleApiError(error: unknown): { content: Array<{ type: string; text: string }>; isError: boolean } {
		if (axios.isAxiosError(error)) {
			const errorMessage =
				error.response?.data?.error?.message ||
				error.response?.data?.detail ||
				error.message;
			
			return {
				content: [
					{
						type: "text",
						text: `Perplexity API error: ${errorMessage}`,
					},
				],
				isError: true,
			};
		}

		return {
			content: [
				{
					type: "text", 
					text: `Unexpected error: ${error instanceof Error ? error.message : 'Unknown error'}`,
				},
			],
			isError: true,
		};
	}

	/**
	 * Handles streaming API errors
	 */
	static handleStreamingApiError(error: unknown): { content: Array<{ type: string; text: string }>; isError: boolean } {
		if (axios.isAxiosError(error)) {
			const errorMessage =
				error.response?.data?.error?.message ||
				error.response?.data?.detail ||
				error.message;
			
			return {
				content: [
					{
						type: "text",
						text: `Perplexity API streaming error: ${errorMessage}`,
					},
				],
				isError: true,
			};
		}

		return {
			content: [
				{
					type: "text",
					text: `Unexpected streaming error: ${error instanceof Error ? error.message : 'Unknown error'}`,
				},
			],
			isError: true,
		};
	}
}