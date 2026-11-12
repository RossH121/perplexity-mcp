/**
 * Main MCP server class for Perplexity integration
 */

import { ProtocolError, ProtocolErrorCode, Server, type Tool, type Transport } from "@modelcontextprotocol/server";
import { serveStdio, type StdioServerHandle } from "@modelcontextprotocol/server/stdio";

import { EnvironmentConfig } from "../config/environment.js";
import { SERVER_CONFIG } from "../config/constants.js";
import { SERVER_CAPABILITIES } from "./capabilities.js";
import { SERVER_INSTRUCTIONS } from "./instructions.js";
import { TOOL_SCHEMAS } from "../schemas/toolSchemas.js";
import { createOutputChecker } from "./outputValidation.js";
import { registerAgentFileResources } from "./resources.js";
import { AgentFileRegistry } from "../models/AgentFileRegistry.js";

// Services
import { PerplexityApiService } from "../services/PerplexityApiService.js";
import { ModelSelectionService } from "../services/ModelSelectionService.js";

// Models
import { FilterState } from "../models/FilterState.js";

// Handlers
import { SearchHandler } from "../handlers/SearchHandler.js";
import { RawSearchHandler } from "../handlers/RawSearchHandler.js";
import { AsyncResearchHandler } from "../handlers/AsyncResearchHandler.js";
import { AgentHandler } from "../handlers/AgentHandler.js";
import { AgentRetrieveHandler } from "../handlers/AgentRetrieveHandler.js";
import { AgentCancelHandler } from "../handlers/AgentCancelHandler.js";
import { AgentFilesHandler } from "../handlers/AgentFilesHandler.js";
import { EmbeddingsHandler } from "../handlers/EmbeddingsHandler.js";
import { ContextualizedEmbeddingsHandler } from "../handlers/ContextualizedEmbeddingsHandler.js";
import { DomainFilterHandler } from "../handlers/DomainFilterHandler.js";
import { RecencyFilterHandler } from "../handlers/RecencyFilterHandler.js";
import { FilterManagementHandler } from "../handlers/FilterManagementHandler.js";
import { ModelInfoHandler, ModelSelectionState } from "../handlers/ModelInfoHandler.js";
import { ModelListHandler } from "../handlers/ModelListHandler.js";
import { DecisionsHandler } from "../handlers/DecisionsHandler.js";
import { SkillsHandler } from "../handlers/SkillsHandler.js";

import { McpRequest, HandlerContext } from "../schemas/types.js";
import { ErrorHandler } from "../utils/errorHandling.js";
import { logError } from "../utils/logger.js";

/**
 * Test seam: inject a config and/or a (fake) API service. Production code
 * passes nothing and gets the real EnvironmentConfig + PerplexityApiService.
 */
export interface PerplexityMcpServerOptions {
	config?: EnvironmentConfig;
	apiService?: PerplexityApiService;
}

type ToolHandler = (request: McpRequest, ctx: HandlerContext) => Promise<unknown>;

export class PerplexityMcpServer {
	private server: Server;
	private stdioHandle?: StdioServerHandle;
	private config: EnvironmentConfig;
	
	// Services
	private apiService: PerplexityApiService;
	private modelSelectionService: ModelSelectionService;
	
	// State
	private filterState: FilterState;
	// Agent sandbox files seen this session (backs resources/list).
	private agentFileRegistry: AgentFileRegistry;
	private checkOutput = createOutputChecker(TOOL_SCHEMAS);
	// Stateful Sonar model selection (set_model / deprecated model_info).
	// Replaced as a whole object so readers always see a consistent pair.
	private modelState: ModelSelectionState;
	
	// Handlers
	private searchHandler: SearchHandler;
	private rawSearchHandler: RawSearchHandler;
	private asyncResearchHandler: AsyncResearchHandler;
	private agentHandler: AgentHandler;
	private agentRetrieveHandler: AgentRetrieveHandler;
	private agentCancelHandler: AgentCancelHandler;
	private agentFilesHandler: AgentFilesHandler;
	private embeddingsHandler: EmbeddingsHandler;
	private contextualizedEmbeddingsHandler: ContextualizedEmbeddingsHandler;
	private domainFilterHandler: DomainFilterHandler;
	private recencyFilterHandler: RecencyFilterHandler;
	private filterManagementHandler: FilterManagementHandler;
	private modelInfoHandler: ModelInfoHandler;
	private modelListHandler: ModelListHandler;
	private decisionsHandler: DecisionsHandler;
	private skillsHandler: SkillsHandler;

	// Tool name -> handler. Every name in TOOL_SCHEMAS must have an entry
	// (enforced by the tools/list test).
	private toolHandlers: Record<string, ToolHandler>;

	constructor(options: PerplexityMcpServerOptions = {}) {
		// Initialize configuration
		this.config = options.config ?? new EnvironmentConfig();
		this.modelState = { currentModel: this.config.defaultModel, useAutoSelection: true };

		// Initialize server
		this.server = new Server(
			{
				name: SERVER_CONFIG.name,
				version: SERVER_CONFIG.version,
			},
			{
				capabilities: SERVER_CAPABILITIES,
				instructions: SERVER_INSTRUCTIONS,
			}
		);

		// Initialize services
		this.apiService = options.apiService ?? new PerplexityApiService(this.config);
		this.modelSelectionService = new ModelSelectionService(this.config);
		
		// Initialize state
		this.filterState = new FilterState();

		// Initialize handlers
		this.rawSearchHandler = new RawSearchHandler(this.apiService);
		this.asyncResearchHandler = new AsyncResearchHandler(this.apiService);
		this.agentHandler = new AgentHandler(this.apiService);
		this.agentRetrieveHandler = new AgentRetrieveHandler(this.apiService);
		this.agentCancelHandler = new AgentCancelHandler(this.apiService);
		this.agentFileRegistry = new AgentFileRegistry(() => {
			// Fire-and-forget; fails harmlessly before connect / after close.
			this.server.sendResourceListChanged().catch(() => {});
		});
		this.agentFilesHandler = new AgentFilesHandler(this.apiService, this.agentFileRegistry);
		this.embeddingsHandler = new EmbeddingsHandler(this.apiService);
		this.contextualizedEmbeddingsHandler = new ContextualizedEmbeddingsHandler(this.apiService);
		this.domainFilterHandler = new DomainFilterHandler(this.filterState);
		this.recencyFilterHandler = new RecencyFilterHandler(this.filterState);
		this.filterManagementHandler = new FilterManagementHandler(this.filterState);
		
		const getModelState = () => this.modelState;
		this.modelInfoHandler = new ModelInfoHandler(this.config, getModelState, (state) => {
			this.modelState = state;
		});
		// One instance: it reads model/filter state synchronously at call start.
		this.searchHandler = new SearchHandler(
			this.apiService,
			this.modelSelectionService,
			this.filterState,
			getModelState
		);

		this.modelListHandler = new ModelListHandler(this.apiService);
		this.decisionsHandler = new DecisionsHandler(this.apiService);
		this.skillsHandler = new SkillsHandler(this.apiService);

		this.toolHandlers = {
			search: (req, ctx) => this.searchHandler.handle(req, ctx),
			raw_search: (req, ctx) => this.rawSearchHandler.handle(req, ctx),
			async_research_submit: (req, ctx) => this.asyncResearchHandler.handleSubmit(req, ctx),
			async_research_status: (req, ctx) => this.asyncResearchHandler.handleStatus(req, ctx),
			async_research_list: (req, ctx) => this.asyncResearchHandler.handleList(req, ctx),
			// DEPRECATED alias (remove next release): action submit|status|list.
			async_research: (req, ctx) => this.asyncResearchHandler.handle(req, ctx),
			agent: (req, ctx) => this.agentHandler.handle(req, ctx),
			agent_retrieve: (req, ctx) => this.agentRetrieveHandler.handle(req, ctx),
			agent_cancel: (req, ctx) => this.agentCancelHandler.handle(req, ctx),
			agent_files: (req, ctx) => this.agentFilesHandler.handle(req, ctx),
			embeddings: (req, ctx) => this.embeddingsHandler.handle(req, ctx),
			contextualized_embeddings: (req, ctx) => this.contextualizedEmbeddingsHandler.handle(req, ctx),
			domain_filter: (req, ctx) => this.domainFilterHandler.handle(req, ctx),
			recency_filter: (req, ctx) => this.recencyFilterHandler.handle(req, ctx),
			clear_filters: () => this.filterManagementHandler.handleClearFilters(),
			list_filters: () => this.filterManagementHandler.handleListFilters(),
			get_model_info: (req, ctx) => this.modelInfoHandler.handleGet(req, ctx),
			set_model: (req, ctx) => this.modelInfoHandler.handleSet(req, ctx),
			// DEPRECATED alias (remove next release): view + set + reset.
			model_info: (req, ctx) => this.modelInfoHandler.handle(req, ctx),
			list_models: (req, ctx) => this.modelListHandler.handle(req, ctx),
			decisions: (req, ctx) => this.decisionsHandler.handle(req, ctx),
			list_skills: (req, ctx) => this.skillsHandler.handle(req, ctx),
		};

		this.setupHandlers();
		this.setupResourceHandlers();
		this.setupErrorHandling();
	}

	private setupHandlers() {
		// List tools handler
		this.server.setRequestHandler("tools/list", async () => ({
			// TOOL_SCHEMAS is `as const` (readonly enum tuples), which v2's
			// method-typed handler result rejects structurally; same wire shape.
			tools: TOOL_SCHEMAS as unknown as Tool[],
		}));

		// Call tool handler. Unknown tool -> protocol error (InvalidParams, per
		// spec). Anything a handler throws (ToolInputError for bad arguments,
		// stray SDK errors) -> isError tool result so the model can self-correct.
		this.server.setRequestHandler("tools/call", async (request, reqCtx) => {
			const handler = Object.hasOwn(this.toolHandlers, request.params.name)
				? this.toolHandlers[request.params.name]
				: undefined;
			if (!handler) {
				throw new ProtocolError(
					ProtocolErrorCode.InvalidParams,
					`Unknown tool: ${request.params.name}`
				);
			}

			const ctx: HandlerContext = { signal: reqCtx.mcpReq.signal };
			// Clients may omit `arguments` for tools with no required params;
			// normalize so validators always see an object.
			const normalized: McpRequest = {
				...request,
				params: { ...request.params, arguments: request.params.arguments ?? {} },
			};
			try {
				// isError results pass through; typed tools' structuredContent is
				// validated against outputSchema (see outputValidation.ts).
				return this.checkOutput(request.params.name, await handler(normalized, ctx));
			} catch (error) {
				return ErrorHandler.toToolResult(error);
			}
		});
	}

	private setupResourceHandlers() {
		registerAgentFileResources(this.server, this.apiService, this.agentFileRegistry);
	}

	private setupErrorHandling() {
		// stdout carries only MCP messages; diagnostics go to stderr.
		this.server.onerror = (error) => {
			logError("MCP server error", error);
		};
	}

	/**
	 * Connect to an arbitrary transport. 2025-era only (tests use
	 * InMemoryTransport.createLinkedPair, which v2 limits to that era).
	 */
	async connect(transport: Transport) {
		await this.server.connect(transport);
	}

	async close() {
		if (this.stdioHandle) await this.stdioHandle.close();
		else await this.server.close();
	}

	/**
	 * Serve over stdio via serveStdio, which serves BOTH protocol eras: a
	 * 2025-era `initialize` opening (2024-10-07 ... 2025-11-25) and a
	 * 2026-07-28 `server/discover` opening. One factory instance is pinned
	 * per connection, and stdio has exactly one connection per process, so
	 * returning the already-built Server keeps the stateful filter/model
	 * selection across calls in both eras.
	 */
	/**
	 * Serve one connection through serveStdio. `transport` defaults to the
	 * process's stdio; tests pass an in-memory transport to exercise the
	 * era-negotiating entry (both eras) without spawning a process.
	 */
	serve(transport?: Transport): StdioServerHandle {
		this.stdioHandle = serveStdio(() => this.server, {
			...(transport ? { transport } : {}),
			onerror: (error) => logError("MCP stdio error", error),
		});
		return this.stdioHandle;
	}

	async run() {
		process.on("SIGINT", async () => {
			await this.close();
			process.exit(0);
		});
		this.serve();
	}
}
