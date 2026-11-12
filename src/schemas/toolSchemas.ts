/**
 * MCP tool schemas for the Perplexity server
 */

import { OUTPUT_SCHEMAS } from "./outputSchemas.js";
import {
	VALID_MODELS,
	VALID_EMBEDDING_MODELS,
	VALID_CONTEXTUALIZED_EMBEDDING_MODELS,
	VALID_AGENT_TOOLS,
	VALID_AGENT_REASONING_EFFORT,
	VALID_AGENT_TOOL_CHOICES,
} from "./types.js";

// Reusable JSON-schema structured-output param, shared by `search` and `agent`.
const RESPONSE_FORMAT_SCHEMA = {
	type: "object",
	description:
		"Constrain the model's output to a JSON schema. The response text becomes a JSON object matching the schema. Note: search results/citations are still returned alongside.",
	properties: {
		type: { type: "string", enum: ["json_schema"] },
		json_schema: {
			type: "object",
			properties: {
				name: {
					type: "string",
					description: "Schema name (1-64 alphanumeric chars). Required by the agent tool; defaults to 'response' if omitted.",
				},
				schema: {
					type: "object",
					description: "A JSON Schema object describing the desired output shape.",
				},
				description: { type: "string" },
				strict: {
					type: "boolean",
					description: "Enforce strict schema validation.",
				},
			},
			required: ["schema"],
		},
	},
	required: ["type", "json_schema"],
} as const;

// Raw tool definitions (name, description, inputSchema). Title, annotations
// and _meta are attached from TOOL_METADATA below; see TOOL_SCHEMAS.
const TOOL_DEFINITIONS = [
	{
		name: "search",
		description: "Web search via Perplexity AI with automatic model selection. Returns an AI-synthesized answer with cited sources. The search uses only the query text (not conversation history). Best for: current events, factual research, technical documentation, comparative analysis. Runs on the Perplexity Agent API (Sonar Chat Completions reached end of support on 2026-09-27): the routed Sonar model maps to an Agent effort level (sonar and sonar-pro -> fast, sonar-reasoning-pro -> low, sonar-deep-research -> high). A few Sonar-only params have no Agent equivalent; they are ignored and listed under 'Backend notes' in the result. PERPLEXITY_SEARCH_BACKEND=sonar switches back to the legacy Sonar path.",
		inputSchema: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description: "Direct search query. Be specific with 2-3 context words, use expert terminology. Good: 'Compare 2025 React vs Vue performance for enterprise apps'. Bad: 'tell me about frameworks'. Tips: Use 'site:domain.com' for specific sites, include years for recent info, add 'analyze/compare/explain' for reasoning tasks.",
				},
				stream: {
					type: "boolean",
					description: "Stream the legacy Sonar response (default: false). The result is identical either way; on the agent backend the full response is fetched in one call.",
				},
				search_context_size: {
					type: "string",
					enum: ["low", "medium", "high"],
					description: "Controls how much web context is retrieved. 'low' (default): fastest and cheapest. 'medium': balanced. 'high': maximum depth, higher cost. Sent on the agent backend's web_search tool.",
				},
				search_type: {
					type: "string",
					enum: ["fast", "pro", "auto"],
					description: "Search engine tier. 'fast': quick single-pass (agent backend: web_search search_type fast). 'pro': multi-step Pro Search (agent backend: raises effort fast to low). 'auto': let Perplexity decide; no Agent equivalent, ignored on the agent backend with a note.",
				},
				reasoning_effort: {
					type: "string",
					enum: ["minimal", "low", "medium", "high"],
					description: "Controls reasoning depth. Sent as reasoning.effort on the agent backend (applies to every routed model); on the legacy Sonar backend only meaningful for sonar-deep-research. 'minimal'/'low': faster, simpler. 'medium': balanced. 'high': most thorough, higher token usage.",
				},
				strip_thinking: {
					type: "boolean",
					description: "Remove <think>...</think> reasoning blocks from the response. Useful with sonar-reasoning-pro and sonar-deep-research to save context window space (default: false)",
				},
				search_mode: {
					type: "string",
					enum: ["web", "academic", "sec"],
					description: "'web' (default): standard web search. 'academic': prioritizes peer-reviewed papers, journals, and academic sources (agent backend: approximated with an academic-domain allowlist unless you set domain filters). 'sec': SEC filings and financial documents (agent backend: finance_search tool plus a sec.gov domain filter).",
				},
				search_after_date: {
					type: "string",
					description: "Only include sources published after this date. Format: MM/DD/YYYY (e.g. '3/1/2025').",
				},
				search_before_date: {
					type: "string",
					description: "Only include sources published before this date. Format: MM/DD/YYYY.",
				},
				last_updated_after: {
					type: "string",
					description: "Only include sources last updated after this date. Format: MM/DD/YYYY.",
				},
				last_updated_before: {
					type: "string",
					description: "Only include sources last updated before this date. Format: MM/DD/YYYY.",
				},
				search_language_filter: {
					type: "array",
					items: { type: "string" },
					description: "Restrict sources to these languages. ISO 639-1 codes (e.g. ['en','de']). No Agent API equivalent: ignored on the default agent backend (with a note in the result); honoured only when PERPLEXITY_SEARCH_BACKEND=sonar.",
				},
				language_preference: {
					type: "string",
					description: "Preferred response language. ISO 639-1 code (e.g. 'en', 'es').",
				},
				disable_search: {
					type: "boolean",
					description: "When true, the model answers from its training data only, with no web search. On the agent backend this runs perplexity/sonar directly with no tools, so search filters do not apply.",
				},
				enable_search_classifier: {
					type: "boolean",
					description: "When true, a classifier decides whether a web search is actually needed for the query (Pro Search behavior). On the agent backend the model always makes that decision, so this is ignored with a note.",
				},
				stream_mode: {
					type: "string",
					enum: ["full", "concise"],
					description: "Streaming event format for Pro Search. 'full' (default): reasoning suppressed, metadata inline. 'concise': reasoning events emitted separately. No Agent API equivalent: ignored on the default agent backend (with a note in the result); honoured only when PERPLEXITY_SEARCH_BACKEND=sonar.",
				},
				return_images: {
					type: "boolean",
					description: "Include image results. When true, an '## Images' section of URLs is appended to the output (agent backend: adds the image_search tool, billed per invocation).",
				},
				return_related_questions: {
					type: "boolean",
					description: "Generate follow-up question suggestions, appended as a '## Related Questions' section. No Agent API equivalent: ignored on the default agent backend (with a note in the result); honoured only when PERPLEXITY_SEARCH_BACKEND=sonar.",
				},
				image_domain_filter: {
					type: "array",
					items: { type: "string" },
					description: "Restrict returned images to these domains (requires return_images). The agent backend keeps the first 10.",
				},
				image_format_filter: {
					type: "array",
					items: { type: "string" },
					description: "Restrict returned images to these formats, e.g. ['png','jpeg'] (requires return_images). The agent backend accepts bmp, gif, jpeg ('jpg' is mapped), png, webp, svg.",
				},
				image_results_enhanced_relevance: {
					type: "boolean",
					description: "Enable enhanced relevance ranking for returned images (pairs with return_images). No Agent API equivalent: ignored on the default agent backend (with a note in the result); honoured only when PERPLEXITY_SEARCH_BACKEND=sonar.",
				},
				country: {
					type: "string",
					description: "Localize search to a country. ISO 3166-1 alpha-2 code (e.g. 'US', 'GB'). Sent as web_search_options.user_location.country.",
				},
				latitude: {
					type: "number",
					description: "Approximate user latitude for localized results (sent with country in user_location).",
				},
				longitude: {
					type: "number",
					description: "Approximate user longitude for localized results (sent with country in user_location).",
				},
				city: {
					type: "string",
					description: "User city for localized results (sent in web_search_options.user_location).",
				},
				region: {
					type: "string",
					description: "User region/state for localized results (sent in web_search_options.user_location).",
				},
				recency: {
					type: "string",
					enum: ["hour", "day", "week", "month", "year"],
					description: "Restrict sources to a time window for this request only. Overrides the stateful recency_filter without mutating it. On the agent backend it is dropped (with a note) when search_after_date/search_before_date is also set, because the API rejects the combination.",
				},
				search_domain_filter: {
					type: "array",
					items: { type: "string" },
					maxItems: 20,
					description: "Restrict or exclude source domains for this request only. Max 20. Plain entries allow only those domains (e.g. ['nodejs.org','developer.mozilla.org']); a '-' prefix excludes (e.g. ['-pinterest.com','-quora.com']). One list is either all-allow or all-exclude, not mixed. Overrides the stateful domain_filter without mutating it; [] means no domain filter for this call. Prefer this over the deprecated domain_filter tool.",
				},
				effort: {
					type: "string",
					description: "Agent effort level for this request, bypassing keyword routing and the set_model selection: 'fast', 'low', 'medium', 'high', 'xhigh', 'ultra', or a pinned 'name@latest' / 'name@<version>'. Agent backend only (ignored on PERPLEXITY_SEARCH_BACKEND=sonar). Higher levels cost more and take longer; 'high' and above can take minutes, so for long research prefer async_research_submit.",
				},
				stop: {
					oneOf: [
						{ type: "string" },
						{ type: "array", items: { type: "string" } },
					],
					description: "Stop sequence(s). Generation halts when any is produced. The Agent API rejects stop sequences: ignored on the agent backend (with a note), honoured only when PERPLEXITY_SEARCH_BACKEND=sonar.",
				},
				temperature: {
					type: "number",
					description: "Sampling temperature, 0-2. Lower is more deterministic (default ~0.2).",
				},
				top_p: {
					type: "number",
					description: "Nucleus sampling probability mass, 0-1. Alternative to temperature.",
				},
				max_tokens: {
					type: "number",
					description: "Maximum number of tokens to generate in the completion (max_output_tokens on the agent backend).",
				},
				show_cost: {
					type: "boolean",
					description: "Append a one-line request-cost footer from usage.cost when the API returns it (default: false).",
				},
				response_format: RESPONSE_FORMAT_SCHEMA,
			},
			required: ["query"],
		},
	},
	{
		name: "raw_search",
		description: "Direct web search returning ranked results without LLM synthesis. Faster and cheaper than 'search', use when you need source URLs, titles, and snippets without an AI-generated response. Good for: URL discovery, fact-checking pipelines, building source lists. Supports multi-query (pass an array of up to 5 queries in one request; each query counts separately against the rate limit). To narrow to a corpus (academic, SEC filings) use search_domain_filter, e.g. ['arxiv.org','pubmed.ncbi.nlm.nih.gov'] or ['sec.gov','edgar.sec.gov'], this endpoint has no search_mode (that is a 'search'-tool/Sonar feature).",
		inputSchema: {
			type: "object",
			properties: {
				query: {
					oneOf: [
						{ type: "string" },
						{ type: "array", items: { type: "string" } },
					],
					description: "Search query string, or an array of up to 5 query strings to run in a single request (the API rejects more than 5; each query counts separately against the rate limit).",
				},
				max_results: {
					type: "number",
					description: "Number of results to return (default: 10). 1-20, or 1-50 when search_type is 'people'.",
				},
				max_tokens: {
					type: "number",
					description: "Total token budget across all returned page contents.",
				},
				max_tokens_per_page: {
					type: "number",
					description: "Per-result token cap on extracted page content.",
				},
				search_context_size: {
					type: "string",
					enum: ["low", "medium", "high"],
					description: "How much content to extract from each result page (default: 'high'). No longer in the API reference, but still has an effect (verified 2026-11-12: low < medium < high snippet volume). Prefer max_tokens / max_tokens_per_page for explicit budgets; omit this when using them.",
				},
				search_type: {
					type: "string",
					enum: ["web", "fast", "people"],
					description: "'web' (default): general web results. 'fast': lower-latency tier with the same result shape, cheaper ($1 vs $5 per 1K requests). 'people': People Search routing for professional/person lookups; allows max_results up to 50.",
				},
				recency: {
					type: "string",
					enum: ["hour", "day", "week", "month", "year"],
					description: "Restrict results to a time window.",
				},
				search_after_date: {
					type: "string",
					description: "Include results published after this date. Format: MM/DD/YYYY.",
				},
				search_before_date: {
					type: "string",
					description: "Include results published before this date. Format: MM/DD/YYYY.",
				},
				last_updated_after: {
					type: "string",
					description: "Include results last updated after this date. Format: MM/DD/YYYY.",
				},
				last_updated_before: {
					type: "string",
					description: "Include results last updated before this date. Format: MM/DD/YYYY.",
				},
				search_language_filter: {
					type: "array",
					items: { type: "string" },
					description: "Restrict results to these languages. ISO 639-1 codes.",
				},
				search_domain_filter: {
					type: "array",
					items: { type: "string" },
					description: "Restrict results to (or exclude, with a leading '-') these domains. Max 20. E.g. ['wikipedia.org','-pinterest.com'].",
				},
				country: {
					type: "string",
					description: "Localize results to a country. ISO 3166-1 alpha-2 code (e.g. 'US', 'GB', 'DE').",
				},
			},
			required: ["query"],
		},
	},
	{
		name: "async_research_submit",
		description: "Start a long-running research job and return its id immediately (creates a billed job). Runs as a Perplexity Agent API background run; the Sonar model picks the effort level (default sonar-deep-research -> high). Poll with async_research_status until it completes. The id (resp_...) also works with agent_retrieve, and agent_cancel can stop it. For full control of the run (tools, models, structured output) use 'agent' with background:true instead.",
		inputSchema: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description: "Research question.",
				},
				model: {
					type: "string",
					enum: VALID_MODELS,
					description: "Sonar model whose Agent effort level the job uses (default: sonar-deep-research -> high; sonar-reasoning-pro -> low; sonar and sonar-pro -> fast). With PERPLEXITY_SEARCH_BACKEND=sonar only sonar-deep-research is accepted.",
				},
				reasoning_effort: {
					type: "string",
					enum: ["minimal", "low", "medium", "high"],
					description: "Reasoning depth, sent as reasoning.effort on the Agent API run.",
				},
				search_mode: {
					type: "string",
					enum: ["web", "academic", "sec"],
					description: "Search domain for the job. 'academic' is approximated with an academic-domain allowlist; 'sec' adds finance_search and a sec.gov filter.",
				},
			},
			required: ["query"],
		},
	},
	{
		name: "async_research_status",
		description: "Check a research job started with async_research_submit, and return its report once it completes. Read-only: polling changes nothing. Returns 'not ready yet' while queued or in progress. Agent ids (resp_...) are fetched from the Agent API; bare-UUID ids from the old async Sonar API are polled through the legacy endpoint for as long as it answers.",
		inputSchema: {
			type: "object",
			properties: {
				request_id: {
					type: "string",
					description: "Job id returned by async_research_submit.",
				},
				strip_thinking: {
					type: "boolean",
					description: "Strip <think> blocks from the completed result (default: false).",
				},
			},
			required: ["request_id"],
		},
	},
	{
		name: "async_research_list",
		description: "List research job ids submitted through this server process (with last known status), plus any jobs from the legacy async Sonar API. The Agent API has no list endpoint, so this registry lives in memory and is lost when the server restarts: keep the ids you need. Read-only.",
		inputSchema: {
			type: "object",
			properties: {},
			additionalProperties: false,
		},
	},
	{
		name: "async_research",
		description: "DEPRECATED: use async_research_submit, async_research_status and async_research_list (this combined alias will be removed in the next release). Submit and poll long-running research jobs. Perplexity ended support for async Sonar on 2026-09-27, so submit now queues an Agent API background run (sonar-deep-research -> effort high) and returns its id (resp_...); poll with action 'status' until completed. Ids from the old async Sonar API (bare UUIDs) are still polled through the legacy endpoint for as long as it answers. 'list' shows ids submitted in this server process (not persisted across restarts) plus any legacy async jobs.",
		inputSchema: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: ["submit", "status", "list"],
					description: "'submit': start a new job (requires query). 'status': poll a job (requires request_id). 'list': ids submitted in this server process plus legacy async jobs.",
				},
				query: {
					type: "string",
					description: "Research question. Required when action is 'submit'.",
				},
				request_id: {
					type: "string",
					description: "Job id returned by a prior submit. Required when action is 'status'.",
				},
				model: {
					type: "string",
					enum: VALID_MODELS,
					description: "Sonar model whose Agent effort level the job uses (default: sonar-deep-research -> high; sonar-reasoning-pro -> low; sonar and sonar-pro -> fast). With PERPLEXITY_SEARCH_BACKEND=sonar only sonar-deep-research is accepted.",
				},
				reasoning_effort: {
					type: "string",
					enum: ["minimal", "low", "medium", "high"],
					description: "Reasoning depth, sent as reasoning.effort on the Agent API run.",
				},
				search_mode: {
					type: "string",
					enum: ["web", "academic", "sec"],
					description: "Search domain for the job. 'academic' is approximated with an academic-domain allowlist; 'sec' adds finance_search and a sec.gov filter.",
				},
				strip_thinking: {
					type: "boolean",
					description: "Strip <think> blocks from the completed result (default: false).",
				},
			},
			required: ["action"],
		},
	},
	{
		name: "agent",
		description: "Perplexity Agent API: an agentic loop that can call built-in tools (web_search, fetch_url, people_search, finance_search, image_search, sandbox/code-execution), call remote MCP servers via 'mcp_servers' (optionally gated by require_approval), load 'skills' (e.g. Office document generation), accept image ('images') and document ('files') input, and run third-party models. Use for multi-step tasks that need tool use or a specific external model. Distinct from 'search' (single grounded answer). Pick an 'effort' level, a 'model'/'models' chain, or a saved 'profile'; with none of them, effort 'low' is used. The catalog of valid model ids changes over time - call list_models first if you intend to name a specific 'model'/'models' rather than guessing an id; an invalid one is also reported back with the current valid list so you can retry. For long-running work (especially effort 'xhigh'/'ultra'), set background:true and poll the returned id with agent_retrieve; cancel one early with agent_cancel. To continue a prior run without resending context, pass its id as previous_response_id. Files the agent shares are retrieved with agent_files.",
		inputSchema: {
			type: "object",
			properties: {
				input: {
					type: "string",
					description: "The task or question for the agent. May be empty only when sending 'approval_responses'.",
				},
				images: {
					type: "array",
					items: { type: "string" },
					description: "Image URLs (http(s):// or data:) to attach alongside 'input'. When set, 'input' and these images are combined into one multimodal user message instead of a plain text prompt.",
				},
				files: {
					type: "array",
					description: "Documents (PDF, DOC, DOCX, TXT, RTF) to attach alongside 'input', max 30 (50 MiB decoded inline data in total). Each entry needs exactly one of 'file_url' or 'file_data'. Not available to ZDR organizations.",
					items: {
						type: "object",
						properties: {
							file_url: {
								type: "string",
								description: "Public https:// URL of the document. Treated as a PDF if 'filename' is omitted.",
							},
							file_data: {
								type: "string",
								description: "Base64-encoded document bytes, or a data: URI.",
							},
							filename: {
								type: "string",
								description: "File name including extension (e.g. 'report.docx'); tells the API the format. Recommended with file_data.",
							},
						},
					},
				},
				effort: {
					type: "string",
					description: "Which configuration bundle to run (model, tools, steps, search type): 'fast' (quick lookups), 'low' (everyday research, the default), 'medium' (multi-hop browsing), 'high' (exhaustive research), 'xhigh' (most capable open-ended work), 'ultra' (longest, deepest runs; use background:true). Pin a version with 'name@<version>' (e.g. 'low@2026-11-11.0') or 'name@latest'; the response header echoes the exact version that ran. 'wide-research' is a legacy alias of 'xhigh'. Cannot be combined with 'profile'. Not the same as 'reasoning_effort'.",
				},
				preset: {
					type: "string",
					description: "Deprecated alias of 'effort' (the API renamed it). Prefer 'effort'; if both are set, 'effort' wins.",
				},
				profile: {
					type: "object",
					description: "A saved, versioned agent configuration from the Perplexity API Portal (model, instructions, tools, skills, steps). Request fields override the profile's values, except 'tools', which merge per tool. Cannot be combined with 'effort'/'preset'.",
					properties: {
						type: { type: "string", enum: ["custom"] },
						id: { type: "string", description: "The profile id (e.g. 'profile_...'), 1-128 chars." },
						version: { type: "string", description: "Version to pin, or 'latest'. Omit for latest." },
					},
					required: ["type", "id"],
				},
				model: {
					type: "string",
					description: "Provider-qualified model, e.g. 'anthropic/claude-sonnet-5-5' or 'openai/gpt-6-sol'. The catalog changes over time; call list_models rather than guessing an id. Omit to use an effort level.",
				},
				models: {
					type: "array",
					items: { type: "string" },
					description: "Fallback chain of provider-qualified models; takes precedence over 'model'. Call list_models for currently valid ids.",
				},
				instructions: {
					type: "string",
					description: "System prompt / instructions for the agent.",
				},
				max_steps: {
					type: "number",
					description: "Maximum agentic reasoning/tool steps (1-500). A direct 'model'/'models' run without an effort level defaults to 1 step, so raise this when you give such a run tools (finance_search needs at least 3).",
				},
				max_output_tokens: {
					type: "number",
					description: "Maximum output tokens. Optional for all models; omitted, each generation is capped automatically.",
				},
				language_preference: {
					type: "string",
					description: "Preferred response language. ISO 639-1 code.",
				},
				tools: {
					type: "array",
					items: { type: "string", enum: VALID_AGENT_TOOLS },
					description: "Built-in tools the agent may use. 'web_search': grounded web search (tune with web_search_options). 'fetch_url': retrieve specific URLs. 'people_search': search for people. 'finance_search': structured financial data (quotes, financials, earnings transcripts). 'image_search': find images (results listed under Images). 'sandbox': execute code in an isolated container.",
				},
				web_search_options: {
					type: "object",
					description: "Options for the web_search tool; setting this enables web_search even if 'tools' omits it. Since Oct 2026 every effort level defaults to fast search; set search_type:'web' for standard, deeper search.",
					properties: {
						search_type: { type: "string", enum: ["web", "fast"], description: "'fast' (default for every effort level; cheaper, ~800ms quicker) or 'web' (standard search)." },
						max_results: { type: "number", description: "Results per search, 1-50." },
						max_tokens: { type: "number", description: "Total token budget for retrieved page content." },
						max_tokens_per_page: { type: "number", description: "Token budget per retrieved page." },
						search_context_size: { type: "string", enum: ["low", "medium", "high"], description: "How much retrieved context to feed the model." },
						search_domain_filter: { type: "array", items: { type: "string" }, description: "Up to 20 domains to restrict to; prefix one with '-' to exclude it instead." },
						search_recency_filter: { type: "string", enum: ["hour", "day", "week", "month", "year"], description: "Only results published within this window." },
						search_after_date_filter: { type: "string", description: "Published after this date (e.g. '3/1/2025')." },
						search_before_date_filter: { type: "string", description: "Published before this date (e.g. '3/1/2025')." },
						last_updated_after_filter: { type: "string", description: "Last updated after this date (e.g. '3/1/2025')." },
						last_updated_before_filter: { type: "string", description: "Last updated before this date (e.g. '3/1/2025')." },
						user_location: {
							type: "object",
							description: "Approximate user location to localize results.",
							properties: {
								country: { type: "string", description: "ISO 3166-1 alpha-2 country code, e.g. 'US'." },
								region: { type: "string" },
								city: { type: "string" },
								latitude: { type: "number" },
								longitude: { type: "number" },
							},
						},
					},
				},
				tool_choice: {
					type: "string",
					enum: VALID_AGENT_TOOL_CHOICES,
					description: "'auto' (default): the model decides whether to call tools. 'required': it must call at least one. 'none': no tool calls.",
				},
				reasoning_effort: {
					type: "string",
					enum: VALID_AGENT_REASONING_EFFORT,
					description: "How hard the chosen model reasons (sent as reasoning.effort). 'none'/'minimal'/'low': faster. 'medium': balanced. 'high'/'xhigh'/'max': most thorough. Separate from 'effort', which picks the whole configuration; both can be set together.",
				},
				response_format: RESPONSE_FORMAT_SCHEMA,
				background: {
					type: "boolean",
					description: "When true, the run is queued and returns immediately with a response id and status. Poll the id with agent_retrieve until status is 'completed'. Use for long deep-research runs.",
				},
				mcp_servers: {
					type: "array",
					description: "Remote MCP servers the agent may call natively, in addition to the built-in 'tools'. Streamable HTTP endpoints only (no SSE). By default every MCP tool call auto-runs; set require_approval to gate calls. A single unreachable server fails the whole run with a 424, not just that tool, so only configure trusted, reachable servers.",
					items: {
						type: "object",
						properties: {
							server_label: {
								type: "string",
								description: "Unique label for this server within the request. Pattern: ^[a-zA-Z0-9_-]{1,64}$.",
							},
							server_url: {
								type: "string",
								description: "HTTPS Streamable HTTP endpoint of the MCP server.",
							},
							authorization: {
								type: "string",
								description: "Bearer token for the server. Sent in the request body; never logged or echoed back.",
							},
							headers: {
								type: "object",
								description: "Additional HTTP headers to send to the MCP server.",
							},
							allowed_tools: {
								type: "array",
								items: { type: "string" },
								description: "Allowlist of tool names. Omit to expose every tool discovered on the server.",
							},
							defer_loading: {
								type: "boolean",
								description: "When true, keeps the server's tool schemas out of the initial context until needed. Default false.",
							},
							require_approval: {
								description: "'always': every call from this server needs approval. 'never' (default): calls auto-run. Or an object { always?: { tool_names?, read_only? }, never?: { tool_names?, read_only? } } to gate specific tools. A gated call does not run; the response lists it under 'MCP tool calls awaiting approval' with an approval_request_id. Answer it with 'approval_responses'.",
							},
						},
						required: ["server_label", "server_url"],
					},
				},
				approval_responses: {
					type: "array",
					description: "Approve or deny MCP tool calls a previous run paused on. Requires 'previous_response_id' (that run's id) and the SAME 'mcp_servers' as before, because tools are not carried over. 'input' may be empty, or carry an extra instruction.",
					items: {
						type: "object",
						properties: {
							approval_request_id: { type: "string", description: "The approval_request_id shown for the pending call (mcpr_...)." },
							approve: { type: "boolean", description: "true runs the call; false skips it." },
							reason: { type: "string", description: "Optional explanation for a denial (only allowed when approve is false)." },
						},
						required: ["approval_request_id", "approve"],
					},
				},
				skills: {
					type: "array",
					description: "Skills to make available to the run (max 16). Selecting any skill automatically enables the sandbox tool, so you do not need to also pass 'sandbox' in tools. Skills are not echoed back on the response.",
					items: {
						type: "object",
						properties: {
							type: {
								type: "string",
								enum: ["builtin", "inline", "custom"],
								description: "'builtin': a Perplexity-provided skill selected by name. 'inline': a request-scoped skill you define here. 'custom': a skill uploaded to your account, selected by id.",
							},
							name: {
								type: "string",
								description: "For 'builtin': one of 'office', 'office/docx', 'office/pdf', 'office/pptx', 'office/xlsx' ('office' covers all four). For 'inline': lowercase ASCII with single hyphens, 1-64 chars. Not used for 'custom'.",
							},
							description: {
								type: "string",
								description: "Inline skills only. Short summary (up to 1,024 bytes); disclosed to the model up front to help it decide when to load the skill.",
							},
							instructions: {
								type: "string",
								description: "Inline skills only. Full instructions, loaded on demand. Up to 65,536 bytes.",
							},
							id: {
								type: "string",
								description: "Custom skills only. The skill id ('skill_...').",
							},
							version: {
								type: "string",
								description: "Custom skills only. Version to pin; omit for latest.",
							},
						},
						required: ["type"],
					},
				},
				previous_response_id: {
					type: "string",
					description: "Continue from a previous completed agent run instead of resending the conversation. The prior response must belong to the same account and have completed.",
				},
				store: {
					type: "boolean",
					description: "When false, the response is hidden from later agent_retrieve calls. It can still be used as a previous_response_id continuation source.",
				},
				temperature: {
					type: "number",
					description: "Sampling temperature.",
				},
				top_p: {
					type: "number",
					description: "Nucleus sampling probability mass.",
				},
				service_tier: {
					type: "string",
					description: "Processing tier: omit, 'auto' or 'default' for standard processing; 'flex' is best-effort at 0.5x token prices (OpenAI models); 'priority' (alias 'fast') is priority processing at 2x token prices. Do not set 'priority'/'fast' unless you want that tradeoff. Unsupported tiers are not rejected; the response header shows the tier that actually served the request.",
				},
				prompt_cache_key: {
					type: "string",
					description: "Overrides the automatic prompt cache key. Effort levels set a stable key by default; this is a cost-optimization knob with no behavioral effect if omitted.",
				},
			},
			required: ["input"],
		},
	},
	{
		name: "agent_retrieve",
		description: "Retrieve the result of a background Agent API run (one submitted with agent + background:true). Returns the current status and, once complete, the full output. Poll until status is 'completed'. Note: a run submitted with store:false is not retrievable here, though it can still be continued via the agent tool's previous_response_id.",
		inputSchema: {
			type: "object",
			properties: {
				response_id: {
					type: "string",
					description: "The response id returned by a prior agent call with background:true.",
				},
			},
			required: ["response_id"],
		},
	},
	{
		name: "agent_cancel",
		description: "Cancel an in-progress agent run (typically one submitted with background:true). Cancellation is asynchronous, poll agent_retrieve afterward to confirm the final status.",
		inputSchema: {
			type: "object",
			properties: {
				response_id: {
					type: "string",
					description: "The response id of the run to cancel.",
				},
			},
			required: ["response_id"],
		},
	},
	{
		name: "agent_files",
		description: "List or retrieve files produced by an agent run's sandbox tool calls. Use action:'list' to see what a run produced, then action:'content' with a file_id to fetch one. Files over 5 MB cannot be inlined and are reported as too large instead. Only files the agent explicitly delivered with its share_file tool are listed (the 'office/*' skills do this; such files also appear under 'Shared files' in the agent output). Files merely written to disk during raw code execution do not appear here, even if the agent reports having written them; ask it to share the file.",
		inputSchema: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: ["list", "content"],
					description: "'list': list files for a run. 'content': download one file's bytes.",
				},
				response_id: {
					type: "string",
					description: "The response id of the agent run that produced the file(s).",
				},
				file_id: {
					type: "string",
					description: "Required for action:'content'. The file id from a prior 'list' call.",
				},
			},
			required: ["action", "response_id"],
		},
	},
	{
		name: "embeddings",
		description: "Generate text embeddings via the Perplexity Embeddings API. Returns a compact summary (model, vector count, token usage) by default; pass full:true to include the raw base64-encoded vectors.",
		inputSchema: {
			type: "object",
			properties: {
				input: {
					oneOf: [
						{ type: "string" },
						{ type: "array", items: { type: "string" } },
					],
					description: "Text to embed, or an array of texts (max 512 per request).",
				},
				model: {
					type: "string",
					enum: VALID_EMBEDDING_MODELS,
					description: "Embedding model (default: pplx-embed-v1-0.6b).",
				},
				dimensions: {
					type: "number",
					description: "Output dimensions (Matryoshka). 128-1024 for 0.6b, 128-2560 for 4b. Defaults to full dimensions.",
				},
				encoding_format: {
					type: "string",
					enum: ["base64_int8", "base64_binary"],
					description: "Quantized output encoding. 'base64_int8': base64-encoded signed int8 values. 'base64_binary': base64-encoded packed binary, 1 bit per dimension (8x smaller than int8). Default when omitted: 'base64_int8' (the API has no full-precision float output).",
				},
				full: {
					type: "boolean",
					description: "Include the raw base64-encoded embedding vectors in the output (default: false).",
				},
			},
			required: ["input"],
		},
	},
	{
		name: "contextualized_embeddings",
		description: "Generate document-chunk-aware embeddings via the Perplexity Contextualized Embeddings API. Distinct from 'embeddings': input is a nested array, one inner array of chunk strings per document, and chunks from the same document share context awareness, improving retrieval quality for document-based (RAG) applications. Returns a compact summary by default; pass full:true to include the raw base64-encoded vectors.",
		inputSchema: {
			type: "object",
			properties: {
				input: {
					type: "array",
					items: { type: "array", items: { type: "string" } },
					description: "One array of chunk strings per document. Max 512 documents, 16,000 chunks total, 32K tokens/document, 120K tokens/request.",
				},
				model: {
					type: "string",
					enum: VALID_CONTEXTUALIZED_EMBEDDING_MODELS,
					description: "Contextualized embedding model (default: pplx-embed-context-v1-0.6b).",
				},
				dimensions: {
					type: "number",
					description: "Output dimensions (Matryoshka). 128-1024 for 0.6b, 128-2560 for 4b. Defaults to full dimensions.",
				},
				encoding_format: {
					type: "string",
					enum: ["base64_int8", "base64_binary"],
					description: "Quantized output encoding. 'base64_int8': base64-encoded signed int8 values. 'base64_binary': base64-encoded packed binary, 1 bit per dimension (8x smaller than int8). Default when omitted: 'base64_int8' (the API has no full-precision float output).",
				},
				full: {
					type: "boolean",
					description: "Include the raw base64-encoded embedding vectors in the output (default: false).",
				},
			},
			required: ["input"],
		},
	},
	{
		name: "domain_filter",
		description: "DEPRECATED: use the per-call search_domain_filter param on search instead (shared state applies to every later search, including parallel ones; this tool will be removed in a later release). Configure domain filtering for search results. Use 'allow' to restrict results to trusted sources (e.g., documentation sites, academic domains) or 'block' to exclude unreliable sources. Maximum 20 domains total. Cannot mix allow and block in the same filter set — use clear_filters first to switch modes. Filters persist across searches until cleared.",
		inputSchema: {
			type: "object",
			properties: {
				domain: {
					type: "string",
					description: "Domain name without protocol. Examples: 'wikipedia.org', 'docs.python.org', 'arxiv.org'. For subdomains: 'api.example.com'",
				},
				action: {
					type: "string",
					enum: ["allow", "block"],
					description: "'allow' restricts results to this domain only (allowlist mode). 'block' excludes this domain from results (denylist mode).",
				},
			},
			required: ["domain", "action"],
		},
	},
	{
		name: "recency_filter",
		description: "DEPRECATED: use the per-call recency (or search_after_date/search_before_date) params on search instead (this tool will be removed in a later release). Control the time window for search results. Essential for time-sensitive queries like news, updates, or recent developments. Filter persists until changed.",
		inputSchema: {
			type: "object",
			properties: {
				filter: {
					type: "string",
					enum: ["hour", "day", "week", "month", "year", "none"],
					description: "Time window: 'hour' for breaking news, 'day' for daily updates, 'week' for recent developments, 'month' for broader recent context, 'year' for the past year, 'none' to include all time periods",
				},
			},
			required: ["filter"],
		},
	},
	{
		name: "clear_filters",
		description: "DEPRECATED: only affects the stateful filters set by the deprecated domain_filter/recency_filter tools; prefer per-call params on search. Remove all domain filters (both allowed and blocked) and recency filter. Use when switching search contexts or starting fresh.",
		inputSchema: {
			type: "object",
			properties: {},
			additionalProperties: false,
		},
	},
	{
		name: "list_filters",
		description: "DEPRECATED: only reports the stateful filters set by the deprecated domain_filter/recency_filter tools; prefer per-call params on search. Display current filter configuration including allowed domains, blocked domains, and active recency setting. Useful for debugging search behavior.",
		inputSchema: {
			type: "object",
			properties: {},
			additionalProperties: false,
		},
	},
	{
		name: "get_model_info",
		description: "Show the Sonar model selection used by 'search': the current model, the default model, whether keyword auto-selection is on, and every model with its routing keywords. Read-only; changes nothing. Use set_model to change the selection.",
		inputSchema: {
			type: "object",
			properties: {},
			additionalProperties: false,
		},
	},
	{
		name: "set_model",
		description: "Override the Sonar model used by 'search' for all later calls in this server process, or pass 'auto' to restore the default model with keyword auto-selection. A set model is still overridden when a query strongly matches another model's keywords. For one call only, use search's 'effort' param instead (agent backend), which bypasses this selection and does not change shared state.",
		inputSchema: {
			type: "object",
			properties: {
				model: {
					type: "string",
					enum: [...VALID_MODELS, "auto"],
					description: "'sonar-deep-research' for comprehensive analysis, 'sonar-reasoning-pro' for complex logic and chain-of-thought, 'sonar-pro' for general search, 'sonar' for quick lookups, or 'auto' to reset to the default with auto-selection.",
				},
			},
			required: ["model"],
		},
	},
	{
		name: "model_info",
		description: "DEPRECATED: use get_model_info (view) and set_model (override) (this alias will be removed in the next release). Calling it with no arguments RESETS the selection to the default. View available Perplexity models and their specializations, or manually override model selection. By default, models are auto-selected based on query intent (research, reasoning, general search).",
		inputSchema: {
			type: "object",
			properties: {
				model: {
					type: "string",
					enum: VALID_MODELS,
					description: "Optional: Override auto-selection. 'sonar-deep-research' for comprehensive analysis, 'sonar-reasoning-pro' for complex logic and chain-of-thought, 'sonar-pro' for general search, 'sonar' for quick lookups",
				},
			},
		},
	},
	{
		name: "list_models",
		description: "List the models currently available to your account via the live GET /v1/models endpoint (dynamic discovery), grouped by provider. These are the models usable through the 'agent' tool's 'model'/'models' params: provider-qualified ids (e.g. 'anthropic/claude-sonnet-5-5', 'openai/gpt-6-sol', 'perplexity/sonar'). It does not list the Sonar models used by 'search' (sonar-pro, sonar-reasoning-pro, ...); see get_model_info for those. Call this before using 'agent' with an explicit 'model' or 'models' value - the catalog changes over time, so an id from memory or an older run may no longer be valid; use 'provider' to narrow to one vendor. Distinct from get_model_info/set_model, which manage the stateful Sonar model used by 'search'.",
		inputSchema: {
			type: "object",
			properties: {
				provider: {
					type: "string",
					description: "Optional: only return models from this provider (matched against each model's 'owned_by', e.g. 'anthropic', 'openai', 'perplexity').",
				},
			},
		},
	},
	{
		name: "decisions",
		description: "Perplexity Decisions API: answer one or more named questions about some content ('state') with calibrated probabilities instead of prose. Question types: 'noul' (yes/no or true/false; returns P(yes)), 'choice' (pick one of your named options; returns the winner, confidence and per-option probabilities), 'score' (rate on an ordered rubric; returns the expected level, confidence and per-level probabilities). Use it for classification, gating, triage, fact-checking or rubric grading where you want a number, not an essay. No rationale text is returned. Set mode:'web_grounding' to run one web search per question first (sources are listed) and, if 'state' is just a URL, fetch that page as the state. Very cheap: $0.02 (or $0.01 for flash models) per million input tokens, output free, plus $0.001 per web search/fetch.",
		inputSchema: {
			type: "object",
			properties: {
				state: {
					oneOf: [
						{ type: "string" },
						{ type: "object" },
						{ type: "array" },
					],
					description: "The content every question refers to: text, a JSON object, or an array. Images may appear as OpenAI-style image_url parts with base64 PNG/JPEG/WebP data URLs (up to 8 per question). With mode:'web_grounding', a bare page URL here is fetched and replaced by its text.",
				},
				questions: {
					type: "object",
					description: "Questions keyed by a name you choose (answers come back under the same names). At least one; with web_grounding at most 100. Examples: {\"defect\": {\"type\":\"noul\", \"instructions\":\"Does the review report a defect?\"}}, {\"sentiment\": {\"type\":\"choice\", \"criteria\": {\"positive\":\"Mostly satisfied\", \"mixed\":null, \"negative\":\"Mostly dissatisfied\"}}}, {\"severity\": {\"type\":\"score\", \"instructions\":\"How severe?\", \"criteria\": [\"Cosmetic\",\"Inconvenient\",\"Unusable\"]}}.",
					additionalProperties: {
						type: "object",
						properties: {
							type: {
								type: "string",
								enum: ["noul", "choice", "score"],
								description: "'noul': yes/no probability. 'choice': pick one option. 'score': ordered rubric.",
							},
							instructions: {
								type: "string",
								description: "The question to answer or statement to check. Required for noul unless criteria is given.",
							},
							criteria: {
								oneOf: [
									{ type: "object" },
									{ type: "array", items: { type: "string" } },
								],
								description: "noul: optional {\"true\": \"what yes means\", \"false\": \"what no means\"}. choice (required): option name -> description, or null to let the name speak for itself (1-255 options). score (required): array of 1-10 ordered level descriptions; the index is the score, from 0.",
							},
						},
						required: ["type"],
					},
				},
				model: {
					type: "string",
					description: "Decision model (default: pplx-decider-latest = pplx-decider-v1.2, 27B). 'pplx-decider-flash-latest' (4B) is half the price and answers each question separately. Pinned ids: pplx-decider-v1.2, pplx-decider-flash-v1.2.",
				},
				mode: {
					type: "string",
					enum: ["web_grounding"],
					description: "Set to 'web_grounding' to search the web (one Fast Search per question) and add the top results to state before answering. Omit to answer from state alone.",
				},
				max_staleness: {
					type: "integer",
					minimum: 0,
					description: "With web_grounding and a URL-only state: maximum age in seconds of the stored page copy; older copies are re-crawled. Omit for no age limit. Does not filter search results.",
				},
			},
			required: ["state", "questions"],
		},
	},
	{
		name: "list_skills",
		description: "List the custom (managed) skills uploaded to this Perplexity project, or get one by skill_id. Use it to find the 'skill_...' id to pass to the agent tool as skills: [{type:'custom', id}]. Builtin skills (office, office/docx, office/pdf, office/pptx, office/xlsx) and inline skills need no lookup. Read-only; uploading or deleting skills is not supported here.",
		inputSchema: {
			type: "object",
			properties: {
				skill_id: {
					type: "string",
					description: "Optional: a 'skill_...' id. When set, returns that skill's details instead of the list.",
				},
				revision: {
					type: "string",
					description: "Optional, with skill_id: a specific revision to describe (default: latest).",
				},
				limit: {
					type: "integer",
					minimum: 1,
					description: "Optional: maximum skills to list per page.",
				},
				page_token: {
					type: "string",
					description: "Optional: next_page_token from a previous list call.",
				},
			},
			additionalProperties: false,
		},
	},
] as const;

export type ToolName = (typeof TOOL_DEFINITIONS)[number]["name"];

export interface ToolAnnotations {
	readOnlyHint: boolean;
	destructiveHint: boolean;
	idempotentHint: boolean;
	openWorldHint: boolean;
}

interface ToolMetadata {
	title: string;
	annotations: ToolAnnotations;
	_meta?: Record<string, unknown>;
}

// Claude Code spills text results over 50,000 chars to a file unless the tool
// raises this limit (hard ceiling 500,000). Applied to the long-prose tools;
// async_research completions have been observed around 80,000 chars.
const LARGE_RESULT_META = { "anthropic/maxResultSizeChars": 500000 } as const;

/*
 * Annotation rationale. MCP defaults for unset hints are the worst case
 * (readOnly false, destructive true, idempotent false, openWorld true), and
 * Claude Code runs readOnlyHint:true tools in parallel and treats
 * readOnly/idempotent tools as safe to retry.
 * - readOnlyHint: true only when the call changes no state anywhere. Being
 *   billed per call is not a side effect. search reads, but never writes,
 *   the local filter state.
 * - openWorldHint: false only for tools that touch local in-process state
 *   and never call Perplexity.
 * - Filter/model setters are local writes: not destructive (they add or
 *   overwrite a setting), idempotent (same call twice = same state), and
 *   non-read-only, which also keeps them sequential in Claude Code so they
 *   don't race parallel searches.
 * - clear_filters discards the configured filters, so it is destructive.
 * - agent can call user-supplied remote MCP servers whose tools may have side
 *   effects, so destructiveHint stays true (the worst case) for it.
 * - agent_cancel irreversibly stops a remote run: destructive, idempotent.
 * - async_research_submit creates a billed remote job: a write, not
 *   destructive, not idempotent (two calls = two jobs).
 * - async_research_status / async_research_list and get_model_info only
 *   read, so they are read-only + idempotent (status updates the in-process
 *   registry's last-seen status, a cache, not state a caller can observe as a
 *   side effect). get_model_info touches no network: openWorld false.
 * - set_model is a local state write, like the filter setters.
 * - Deprecated aliases (async_research, model_info) keep their combined,
 *   worst-case annotations: they can still write.
 */
const READ_ONLY_REMOTE: ToolAnnotations = {
	readOnlyHint: true,
	destructiveHint: false,
	idempotentHint: false,
	openWorldHint: true,
};
const READ_ONLY_REMOTE_IDEMPOTENT: ToolAnnotations = { ...READ_ONLY_REMOTE, idempotentHint: true };
const LOCAL_STATE_WRITE: ToolAnnotations = {
	readOnlyHint: false,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: false,
};

// Record<ToolName, ...> makes the compiler reject a tool without metadata.
const TOOL_METADATA: Record<ToolName, ToolMetadata> = {
	search: { title: "Perplexity Search", annotations: READ_ONLY_REMOTE, _meta: LARGE_RESULT_META },
	raw_search: { title: "Perplexity Raw Search Results", annotations: READ_ONLY_REMOTE },
	async_research_submit: {
		title: "Submit Async Research Job",
		annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	},
	async_research_status: {
		title: "Async Research Job Status",
		annotations: READ_ONLY_REMOTE_IDEMPOTENT,
		_meta: LARGE_RESULT_META,
	},
	async_research_list: { title: "List Async Research Jobs", annotations: READ_ONLY_REMOTE_IDEMPOTENT },
	// DEPRECATED alias: remove next release.
	async_research: {
		title: "Async Deep Research Jobs (Deprecated)",
		annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
		_meta: LARGE_RESULT_META,
	},
	agent: {
		title: "Perplexity Agent Run",
		annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
		_meta: LARGE_RESULT_META,
	},
	agent_retrieve: { title: "Retrieve Agent Run", annotations: READ_ONLY_REMOTE_IDEMPOTENT, _meta: LARGE_RESULT_META },
	agent_cancel: {
		title: "Cancel Agent Run",
		annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
	},
	agent_files: { title: "Agent Sandbox Files", annotations: READ_ONLY_REMOTE_IDEMPOTENT },
	embeddings: { title: "Text Embeddings", annotations: READ_ONLY_REMOTE },
	contextualized_embeddings: { title: "Contextualized Embeddings", annotations: READ_ONLY_REMOTE },
	domain_filter: { title: "Set Domain Filter", annotations: LOCAL_STATE_WRITE },
	recency_filter: { title: "Set Recency Filter", annotations: LOCAL_STATE_WRITE },
	clear_filters: { title: "Clear Search Filters", annotations: { ...LOCAL_STATE_WRITE, destructiveHint: true } },
	list_filters: {
		title: "List Search Filters",
		annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
	},
	get_model_info: {
		title: "Get Search Model Info",
		annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
	},
	set_model: { title: "Set Search Model", annotations: LOCAL_STATE_WRITE },
	// DEPRECATED alias: remove next release.
	model_info: { title: "Search Model Info / Override (Deprecated)", annotations: LOCAL_STATE_WRITE },
	list_models: { title: "List Available Models", annotations: READ_ONLY_REMOTE_IDEMPOTENT },
	// Billed, but evaluates caller-supplied state and writes nothing:
	// read-only. Probabilities can shift between calls: not idempotent.
	decisions: { title: "Perplexity Decisions (Probabilistic Answers)", annotations: READ_ONLY_REMOTE },
	list_skills: { title: "List Custom Skills", annotations: READ_ONLY_REMOTE_IDEMPOTENT },
};

/**
 * Tool list served by tools/list. To add a tool: append its definition to
 * TOOL_DEFINITIONS, add a TOOL_METADATA entry (the compiler enforces it), and
 * register a handler in PerplexityMcpServer's toolHandlers map.
 */
export const TOOL_SCHEMAS = TOOL_DEFINITIONS.map((tool) => ({
	...tool,
	...TOOL_METADATA[tool.name],
	// outputSchema convention: see src/schemas/outputSchemas.ts.
	...(Object.hasOwn(OUTPUT_SCHEMAS, tool.name) ? { outputSchema: OUTPUT_SCHEMAS[tool.name] } : {}),
}));
