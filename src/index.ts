#!/usr/bin/env node

/**
 * Main entry point for the Perplexity MCP server
 * 
 * This is a Model Context Protocol (MCP) server that provides web search capabilities
 * using Perplexity AI. The server acts as a bridge between Claude and Perplexity's search API.
 */

import { PerplexityMcpServer } from "./server/PerplexityMcpServer.js";
import { logError } from "./utils/logger.js";

try {
	const server = new PerplexityMcpServer();
	server.run().catch((error) => {
		logError("Failed to start", error);
		process.exit(1);
	});
} catch (error) {
	// e.g. missing PERPLEXITY_API_KEY. stderr only; stdout is the MCP channel.
	logError("Failed to start", error);
	process.exit(1);
}