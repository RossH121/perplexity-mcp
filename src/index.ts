#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	CallToolRequestSchema,
	ErrorCode,
	ListToolsRequestSchema,
	McpError,
} from "@modelcontextprotocol/sdk/types.js";

import axios, { type AxiosInstance } from "axios";

const API_KEY = process.env.PERPLEXITY_API_KEY;

if (!API_KEY) {
	throw new Error("PERPLEXITY_API_KEY environment variable is required");
}

const VALID_MODELS = [
	"sonar-deep-research",
	"sonar-reasoning-pro",
	"sonar-reasoning",
	"sonar-pro",
	"sonar",
];
const DEFAULT_MODEL = process.env.PERPLEXITY_MODEL || "sonar-pro";

// Model selection criteria based on user intent
interface ModelSelectionCriteria {
	keywords: string[];
	description: string;
}

// Define models and their intent detection criteria
const MODEL_SELECTION_MAP: Record<string, ModelSelectionCriteria> = {
	"sonar-deep-research": {
		keywords: [
			"deep research",
			"comprehensive",
			"thorough",
			"detailed analysis",
			"expert",
			"in-depth",
		],
		description:
			"specialized for extensive research and expert-level analysis across domains",
	},
	"sonar-reasoning-pro": {
		keywords: [
			"reasoning",
			"logic",
			"solve",
			"mathematical",
			"technical",
			"complex problem",
			"figure out",
		],
		description:
			"optimized for advanced logical reasoning and complex problem-solving",
	},
	"sonar-reasoning": {
		keywords: ["reason", "think", "analyze", "deduce", "evaluate"],
		description: "designed for reasoning tasks with balanced performance",
	},
	"sonar-pro": {
		keywords: [
			"search",
			"find",
			"lookup",
			"information",
			"facts",
			"details",
			"latest",
		],
		description:
			"general-purpose model with excellent search capabilities and citation density",
	},
	sonar: {
		keywords: ["quick", "simple", "basic", "brief", "short"],
		description: "fast and efficient for straightforward queries",
	},
};

if (!VALID_MODELS.includes(DEFAULT_MODEL)) {
	throw new Error(
		`Invalid default model '${DEFAULT_MODEL}'. Valid models are: ${VALID_MODELS.join(", ")}`,
	);
}

interface SearchResponse {
	choices: [
		{
			message: {
				content: string;
			};
		},
	];
}

/**
 * Selects the most appropriate model based on the user's query text
 * @param query The user's search query
 * @returns An object containing the selected model and description
 */
function selectModelBasedOnIntent(query: string): {
	model: string;
	description: string;
	score: number;
} {
	// Convert query to lowercase for case-insensitive matching
	const lowercaseQuery = query.toLowerCase();

	// Calculate scores for each model based on keyword matches
	const modelScores = Object.entries(MODEL_SELECTION_MAP).map(
		([model, criteria]) => {
			const score = criteria.keywords.reduce((total, keyword) => {
				// Add 1 to the score for each keyword that appears in the query
				return total + (lowercaseQuery.includes(keyword.toLowerCase()) ? 1 : 0);
			}, 0);

			return {
				model,
				score,
				description: criteria.description,
			};
		},
	);

	// Sort models by score (descending)
	modelScores.sort((a, b) => b.score - a.score);

	// If no keywords matched or all scores are 0, use the default model
	if (modelScores[0].score === 0) {
		return {
			model: DEFAULT_MODEL,
			description: MODEL_SELECTION_MAP[DEFAULT_MODEL].description,
			score: 0,
		};
	}

	// Return the model with the highest score
	return {
		model: modelScores[0].model,
		description: modelScores[0].description,
		score: modelScores[0].score,
	};
}

// Maintain a list of allowed/blocked domains for search filters
interface DomainFilters {
	allowedDomains: string[];
	blockedDomains: string[];
}

// Request validation interfaces
interface SearchArgs {
	query: string;
}

interface DomainArgs {
	domain: string;
	action: "allow" | "block";
}

interface RecencyArgs {
	filter: string;
}

interface ModelArgs {
	model?: string;
}

interface RequestParams {
	name: string;
	arguments?: Record<string, unknown>;
	_meta?: unknown;
}

interface McpRequest {
	params: RequestParams;
	method?: string;
}

const isValidSearchArgs = (args: unknown): args is SearchArgs =>
	typeof args === "object" &&
	args !== null &&
	typeof (args as SearchArgs).query === "string" &&
	(args as SearchArgs).query.trim().length > 0;

const isValidDomainArgs = (args: unknown): args is DomainArgs =>
	typeof args === "object" &&
	args !== null &&
	typeof (args as DomainArgs).domain === "string" &&
	(args as DomainArgs).domain.trim().length > 0 &&
	["allow", "block"].includes((args as DomainArgs).action);

const isValidRecencyArgs = (args: unknown): args is RecencyArgs =>
	typeof args === "object" &&
	args !== null &&
	typeof (args as RecencyArgs).filter === "string" &&
	["hour", "day", "week", "month", "none"].includes(
		(args as RecencyArgs).filter,
	);

const isValidModelArgs = (args: unknown): args is ModelArgs =>
	typeof args === "object" &&
	args !== null &&
	((args as ModelArgs).model === undefined ||
		(typeof (args as ModelArgs).model === "string" &&
			VALID_MODELS.includes((args as ModelArgs).model as string)));

class PerplexityServer {
	private server: Server;
	private axiosInstance: AxiosInstance;
	private domainFilters: DomainFilters = {
		allowedDomains: [],
		blockedDomains: [],
	};
	private recencyFilter: string | null = null;
	private currentModel: string = DEFAULT_MODEL;
	private useAutoSelection = true;

	constructor() {
		this.server = new Server(
			{
				name: "perplexity-search-server",
				version: "0.1.0",
			},
			{
				capabilities: {
					tools: {},
				},
			},
		);

		this.axiosInstance = axios.create({
			baseURL: "https://api.perplexity.ai",
			headers: {
				Authorization: `Bearer ${API_KEY}`,
				"Content-Type": "application/json",
			},
		});

		this.setupToolHandlers();

		// Error handling
		this.server.onerror = (error) => { /* Silent error handling for MCP compliance */ };
		process.on("SIGINT", async () => {
			await this.server.close();
			process.exit(0);
		});
	}

	private setupToolHandlers() {
		this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
			tools: [
				{
					name: "search",
					description: "Search the web using Perplexity AI",
					inputSchema: {
						type: "object",
						properties: {
							query: {
								type: "string",
								description: "The search query",
							},
						},
						required: ["query"],
					},
				},
				{
					name: "domain_filter",
					description:
						"Add a domain to allow or block in search results (max 3 domains per type)",
					inputSchema: {
						type: "object",
						properties: {
							domain: {
								type: "string",
								description:
									"Domain name without http:// or https:// (example: wikipedia.org)",
							},
							action: {
								type: "string",
								enum: ["allow", "block"],
								description: "Whether to allow or block this domain",
							},
						},
						required: ["domain", "action"],
					},
				},
				{
					name: "recency_filter",
					description: "Set the time recency for search results",
					inputSchema: {
						type: "object",
						properties: {
							filter: {
								type: "string",
								enum: ["hour", "day", "week", "month", "none"],
								description:
									"Time window for search results (none to disable filtering)",
							},
						},
						required: ["filter"],
					},
				},
				{
					name: "clear_filters",
					description: "Clear all domain filters",
					inputSchema: {
						type: "object",
						properties: {},
					},
				},
				{
					name: "list_filters",
					description: "List all current domain filters",
					inputSchema: {
						type: "object",
						properties: {},
					},
				},
				{
					name: "model_info",
					description:
						"Get information about available models and optionally set a specific model",
					inputSchema: {
						type: "object",
						properties: {
							model: {
								type: "string",
								enum: VALID_MODELS,
								description:
									"Optional: Set a specific model instead of using automatic selection",
							},
						},
					},
				},
			],
		}));

		this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
			switch (request.params.name) {
				case "search":
					return this.handleSearch(request);
				case "domain_filter":
					return this.handleDomainFilter(request);
				case "recency_filter":
					return this.handleRecencyFilter(request);
				case "clear_filters":
					return this.handleClearFilters();
				case "list_filters":
					return this.handleListFilters();
				case "model_info":
					return this.handleModelInfo(request);
				default:
					throw new McpError(
						ErrorCode.MethodNotFound,
						`Unknown tool: ${request.params.name}`,
					);
			}
		});
	}

	private async handleSearch(request: McpRequest) {
		if (!isValidSearchArgs(request.params.arguments)) {
			throw new McpError(
				ErrorCode.InvalidParams,
				"Invalid search arguments. Query must be a non-empty string.",
			);
		}

		try {
			// Build search_domain_filter array based on configured domains
			const domainFilterArray: string[] = [];

			// Add allowed domains (up to 3)
			const allowedDomainsToUse = this.domainFilters.allowedDomains.slice(0, 3);
			for (const domain of allowedDomainsToUse) {
				domainFilterArray.push(domain);
			}

			// Add blocked domains (up to 3 if no allowed domains)
			const remainingSlots = 3 - domainFilterArray.length;
			const blockedDomainsToUse = this.domainFilters.blockedDomains.slice(
				0,
				remainingSlots,
			);
			for (const domain of blockedDomainsToUse) {
				domainFilterArray.push(`-${domain}`);
			}

			// Get the user query
			const query = (request.params.arguments as SearchArgs).query;

			// Get model selection based on intent
			const selection = selectModelBasedOnIntent(query);
			let description: string;

			// Determine which model to use
			if (this.useAutoSelection) {
				// Auto-select model based on intent
				this.currentModel = selection.model;
				description = selection.description;
			} else {
				// We're using a manually set model
				// But check if we have a strong match that should override
				if (selection.score >= 2 && selection.model !== this.currentModel) {
					// Strong intent match - override manual selection
					this.currentModel = selection.model;
					description = `${selection.description} (auto-selected based on query intent)`;
				} else {
					// Stick with manually selected model
					description = MODEL_SELECTION_MAP[this.currentModel].description;
				}
			}

			interface ApiParams {
				model: string;
				messages: {
					role: string;
					content: string;
				}[];
				search_domain_filter?: string[];
				search_recency_filter?: string;
			}

			const apiParams: ApiParams = {
				model: this.currentModel,
				messages: [
					{
						role: "system",
						content:
							"You are a helpful assistant that searches the web for accurate information.",
					},
					{
						role: "user",
						content: query,
					},
				],
			};

			// Only add search_domain_filter if we have domains to filter
			if (domainFilterArray.length > 0) {
				apiParams.search_domain_filter = domainFilterArray;
			}

			// Add recency filter if set
			if (this.recencyFilter) {
				apiParams.search_recency_filter = this.recencyFilter;
			}

			const response = (await this.axiosInstance.post(
				"/chat/completions",
				apiParams,
			)) as { data: SearchResponse };

			if (response.data.choices && response.data.choices.length > 0) {
				// Include model information at the start of the response
				const modelInfo = `[Using model: ${this.currentModel} - ${description}]\n\n`;

				return {
					content: [
						{
							type: "text",
							text: modelInfo + response.data.choices[0].message.content,
						},
					],
				};
			}
			throw new Error("No response content received");
		} catch (error) {
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
			throw error;
		}
	}

	private handleDomainFilter(request: McpRequest) {
		if (!isValidDomainArgs(request.params.arguments)) {
			throw new McpError(
				ErrorCode.InvalidParams,
				'Invalid domain filter arguments. Domain must be a non-empty string and action must be "allow" or "block".',
			);
		}

		const { domain, action } = request.params.arguments as DomainArgs;

		// Clean the domain input - remove any protocol prefixes
		const cleanDomain = domain
			.replace(/^https?:\/\//, "")
			.split("/")[0]
			.trim();

		if (action === "allow") {
			// Remove from blocked if it exists there
			this.domainFilters.blockedDomains =
				this.domainFilters.blockedDomains.filter((d) => d !== cleanDomain);

			// Add to allowed if not already there
			if (!this.domainFilters.allowedDomains.includes(cleanDomain)) {
				this.domainFilters.allowedDomains.push(cleanDomain);
			}

			return {
				content: [
					{
						type: "text",
						text: `Added ${cleanDomain} to allowed domains. Search results will prioritize this domain.`,
					},
				],
			};
		}
		// Remove from allowed if it exists there
		this.domainFilters.allowedDomains =
			this.domainFilters.allowedDomains.filter((d) => d !== cleanDomain);

		// Add to blocked if not already there
		if (!this.domainFilters.blockedDomains.includes(cleanDomain)) {
			this.domainFilters.blockedDomains.push(cleanDomain);
		}

		return {
			content: [
				{
					type: "text",
					text: `Added ${cleanDomain} to blocked domains. Search results will exclude this domain.`,
				},
			],
		};
	}

	private handleRecencyFilter(request: McpRequest) {
		if (!isValidRecencyArgs(request.params.arguments)) {
			throw new McpError(
				ErrorCode.InvalidParams,
				"Invalid recency filter argument. Filter must be one of: hour, day, week, month, none.",
			);
		}

		const { filter } = request.params.arguments as RecencyArgs;

		if (filter === "none") {
			this.recencyFilter = null;
			return {
				content: [
					{
						type: "text",
						text: "Recency filter has been disabled. Searches will include results from any time period.",
					},
				],
			};
		}
		this.recencyFilter = filter;
		return {
			content: [
				{
					type: "text",
					text: `Recency filter set to "${filter}". Searches will be limited to content from the last ${
						filter === "hour"
							? "hour"
							: filter === "day"
								? "24 hours"
								: filter === "week"
									? "7 days"
									: "30 days"
					}.`,
				},
			],
		};
	}

	private handleClearFilters() {
		this.domainFilters = {
			allowedDomains: [],
			blockedDomains: [],
		};
		this.recencyFilter = null;

		return {
			content: [
				{
					type: "text",
					text: "All domain and recency filters have been cleared. Searches will use default Perplexity sources.",
				},
			],
		};
	}

	private handleListFilters() {
		const allowedText =
			this.domainFilters.allowedDomains.length > 0
				? `Allowed domains: ${this.domainFilters.allowedDomains.join(", ")}`
				: "No allowed domains configured.";

		const blockedText =
			this.domainFilters.blockedDomains.length > 0
				? `Blocked domains: ${this.domainFilters.blockedDomains.join(", ")}`
				: "No blocked domains configured.";

		const recencyText = this.recencyFilter
			? `Recency filter: ${this.recencyFilter} (limiting to content from the last ${
					this.recencyFilter === "hour"
						? "hour"
						: this.recencyFilter === "day"
							? "24 hours"
							: this.recencyFilter === "week"
								? "7 days"
								: "30 days"
				})`
			: "No recency filter configured.";

		const limitText =
			"Note: Perplexity API supports up to 3 domains total with priority given to allowed domains.";

		return {
			content: [
				{
					type: "text",
					text: `Current filters:\n\n${allowedText}\n${blockedText}\n${recencyText}\n\n${limitText}`,
				},
			],
		};
	}

	private handleModelInfo(request: McpRequest) {
		if (!isValidModelArgs(request.params.arguments)) {
			throw new McpError(
				ErrorCode.InvalidParams,
				"Invalid model argument. Model must be one of the valid models or not provided.",
			);
		}

		// If a specific model is requested, set it and disable auto-selection
		const { model } = request.params.arguments as ModelArgs;
		if (model) {
			this.currentModel = model;
			this.useAutoSelection = false;
		} else {
			// If no model specified, reset to default and re-enable auto-selection
			this.currentModel = DEFAULT_MODEL;
			this.useAutoSelection = true;
		}

		// Build model information text
		const modelInfoLines: string[] = [];

		// Current model status
		if (model) {
			modelInfoLines.push(`Model has been set to: ${this.currentModel}`);
			modelInfoLines.push(
				"Auto-selection: DISABLED (will only switch if query has strong intent matching)",
			);
			modelInfoLines.push(
				"To re-enable auto-selection, run model_info with no parameters",
			);
			modelInfoLines.push("");
		} else {
			modelInfoLines.push(
				`Current model: ${this.currentModel} (reset to default)`,
			);
			modelInfoLines.push(`Default model (from environment): ${DEFAULT_MODEL}`);
			modelInfoLines.push(
				"Auto-selection: ENABLED (model will be selected based on query keywords)",
			);
			modelInfoLines.push("");
		}

		// List available models with descriptions
		modelInfoLines.push("Available models:");
		for (const [modelName, criteria] of Object.entries(MODEL_SELECTION_MAP)) {
			modelInfoLines.push(`- ${modelName}: ${criteria.description}`);
			modelInfoLines.push(`  Keywords: ${criteria.keywords.join(", ")}`);
		}

		// Instructions
		modelInfoLines.push("");
		modelInfoLines.push(
			"To use automatic model selection: Call this tool with no parameters",
		);
		modelInfoLines.push(
			'To set a specific model: Use this tool with the "model" parameter',
		);

		return {
			content: [
				{
					type: "text",
					text: modelInfoLines.join("\n"),
				},
			],
		};
	}

	async run() {
		const transport = new StdioServerTransport();
		await this.server.connect(transport);
		// Server started successfully (logging disabled for STDIO MCP compliance)
	}
}

const server = new PerplexityServer();
server.run().catch(() => process.exit(1));
