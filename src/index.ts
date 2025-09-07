#!/usr/bin/env node

/**
 * Main entry point for the Perplexity MCP server
 * 
 * This is a Model Context Protocol (MCP) server that provides web search capabilities
 * using Perplexity AI. The server acts as a bridge between Claude and Perplexity's search API.
 */

import { PerplexityMcpServer } from "./server/PerplexityMcpServer.js";

const server = new PerplexityMcpServer();
server.run().catch(() => process.exit(1));