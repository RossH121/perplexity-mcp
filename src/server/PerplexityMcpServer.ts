/**
 * Main MCP server class for Perplexity integration
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from "@modelcontextprotocol/sdk/types.js";

import { EnvironmentConfig } from "../config/environment.js";
import { SERVER_CONFIG } from "../config/constants.js";
import { SERVER_CAPABILITIES } from "./capabilities.js";
import { TOOL_SCHEMAS } from "../schemas/toolSchemas.js";

// Services
import { PerplexityApiService } from "../services/PerplexityApiService.js";
import { ModelSelectionService } from "../services/ModelSelectionService.js";

// Models
import { FilterState } from "../models/FilterState.js";

// Handlers
import { SearchHandler } from "../handlers/SearchHandler.js";
import { RawSearchHandler } from "../handlers/RawSearchHandler.js";
import { DomainFilterHandler } from "../handlers/DomainFilterHandler.js";
import { RecencyFilterHandler } from "../handlers/RecencyFilterHandler.js";
import { FilterManagementHandler } from "../handlers/FilterManagementHandler.js";
import { ModelInfoHandler } from "../handlers/ModelInfoHandler.js";

import { McpRequest } from "../schemas/types.js";

export class PerplexityMcpServer {
	private server: Server;
	private config: EnvironmentConfig;
	
	// Services
	private apiService: PerplexityApiService;
	private modelSelectionService: ModelSelectionService;
	
	// State
	private filterState: FilterState;
	private currentModel: string;
	private useAutoSelection = true;
	
	// Handlers
	private searchHandler: SearchHandler;
	private rawSearchHandler: RawSearchHandler;
	private domainFilterHandler: DomainFilterHandler;
	private recencyFilterHandler: RecencyFilterHandler;
	private filterManagementHandler: FilterManagementHandler;
	private modelInfoHandler: ModelInfoHandler;

	constructor() {
		// Initialize configuration
		this.config = new EnvironmentConfig();
		this.currentModel = this.config.defaultModel;

		// Initialize server
		this.server = new Server(
			{
				name: SERVER_CONFIG.name,
				version: SERVER_CONFIG.version,
			},
			{
				capabilities: SERVER_CAPABILITIES,
			}
		);

		// Initialize services
		this.apiService = new PerplexityApiService(this.config);
		this.modelSelectionService = new ModelSelectionService(this.config);
		
		// Initialize state
		this.filterState = new FilterState();

		// Initialize handlers
		this.searchHandler = new SearchHandler(
			this.apiService,
			this.modelSelectionService,
			this.filterState,
			this.currentModel,
			this.useAutoSelection
		);
		
		this.rawSearchHandler = new RawSearchHandler(this.apiService);
		this.domainFilterHandler = new DomainFilterHandler(this.filterState);
		this.recencyFilterHandler = new RecencyFilterHandler(this.filterState);
		this.filterManagementHandler = new FilterManagementHandler(this.filterState);
		
		this.modelInfoHandler = new ModelInfoHandler(
			this.modelSelectionService,
			this.config,
			() => this.currentModel,
			(model: string) => { this.currentModel = model; },
			() => this.useAutoSelection,
			(value: boolean) => { this.useAutoSelection = value; }
		);

		this.setupHandlers();
		this.setupErrorHandling();
	}

	private setupHandlers() {
		// List tools handler
		this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
			tools: TOOL_SCHEMAS,
		}));

		// Call tool handler
		this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
			// Update search handler with current model state
			this.searchHandler = new SearchHandler(
				this.apiService,
				this.modelSelectionService,
				this.filterState,
				this.currentModel,
				this.useAutoSelection
			);

			switch (request.params.name) {
				case "search":
					return this.searchHandler.handle(request);
				case "raw_search":
					return this.rawSearchHandler.handle(request);
				case "domain_filter":
					return this.domainFilterHandler.handle(request);
				case "recency_filter":
					return this.recencyFilterHandler.handle(request);
				case "clear_filters":
					return this.filterManagementHandler.handleClearFilters();
				case "list_filters":
					return this.filterManagementHandler.handleListFilters();
				case "model_info":
					return this.modelInfoHandler.handle(request);
				default:
					throw new McpError(
						ErrorCode.MethodNotFound,
						`Unknown tool: ${request.params.name}`
					);
			}
		});
	}

	private setupErrorHandling() {
		// Error handling
		this.server.onerror = (error) => { 
			/* Silent error handling for MCP compliance */ 
		};
		
		process.on("SIGINT", async () => {
			await this.server.close();
			process.exit(0);
		});
	}

	async run() {
		const transport = new StdioServerTransport();
		await this.server.connect(transport);
		// Server started successfully (logging disabled for STDIO MCP compliance)
	}
}