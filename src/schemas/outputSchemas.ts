/**
 * outputSchema declarations for the data-shaped tools (MCP 2025-06-18+).
 *
 * Convention (see CLAUDE.md "outputSchema convention"):
 * - Every tool listed here MUST return `structuredContent` matching its schema
 *   on EVERY non-error result. The SDK Client throws "has an output schema but
 *   did not return structured content" otherwise. isError results are exempt
 *   and must NOT carry structuredContent (the Client validates it if present).
 * - The human-readable markdown stays in `content[0]` for hosts that ignore
 *   structuredContent. Claude Code may hand the model the JSON of
 *   structuredContent INSTEAD of the text blocks, so structuredContent must be
 *   complete on its own (it carries the answer text for prose-ish tools).
 * - Plain JSON Schema, root `type: "object"`, no root-level oneOf/anyOf.
 *   Optional-but-always-present fields are `["x","null"]` rather than omitted.
 *   Objects stay open (no additionalProperties:false) so additive API fields
 *   never break validation; arrays of records are typed.
 * - The dispatcher in PerplexityMcpServer re-validates server-side and turns a
 *   mismatch into an isError result instead of shipping invalid output.
 */

type JsonSchema = Record<string, unknown>;

const str = { type: "string" } as const;
const num = { type: "number" } as const;
const int = { type: "integer" } as const;
const nstr = { type: ["string", "null"] } as const;
const nnum = { type: ["number", "null"] } as const;
const nint = { type: ["integer", "null"] } as const;
const strArr = { type: "array", items: str } as const;

const obj = (properties: Record<string, unknown>, required: string[] = []): JsonSchema => ({
	type: "object",
	properties,
	required,
});

const arr = (items: JsonSchema) => ({ type: "array", items });

const SOURCE = obj({ title: nstr, url: str, date: nstr, last_updated: nstr, snippet: nstr }, ["url"]);
const IMAGE = obj(
	{ title: nstr, image_url: str, origin_url: nstr, width: nnum, height: nnum },
	["image_url"]
);

const EMBEDDING_SUMMARY_PROPS = {
	model: str,
	dimensions: { ...nint, description: "Vector length: the requested `dimensions`, else the model default; null when unknown." },
	dimensions_source: { type: ["string", "null"], enum: ["requested", "model_default", null] },
	encoding: { ...str, description: "base64_int8 (API default) or base64_binary." },
	tokens: nint,
	cost_usd: nnum,
};

/** Agent API run summary, shared by `agent` and `agent_retrieve`. */
export const AGENT_RUN_OUTPUT_SCHEMA = obj(
	{
		response_id: nstr,
		status: { ...nstr, description: "completed, queued, in_progress, requires_action, cancelling, incomplete, failed, cancelled." },
		model: nstr,
		effort: { ...nstr, description: "Echoed effort pin, e.g. fast@2026-11-11.0." },
		service_tier: nstr,
		output_text: { ...str, description: "The answer text ('' while a background run is pending). A JSON string when response_format was set." },
		status_detail: { ...nstr, description: "Incomplete reason / error message / pause state, when any." },
		sources: arr(SOURCE),
		fetched_urls: arr(obj({ title: nstr, url: nstr, snippet: nstr })),
		images: arr(IMAGE),
		pending_approvals: arr(obj({ id: str, server_label: nstr, name: nstr, arguments: nstr }, ["id"])),
		shared_files: arr(
			obj({ file_id: nstr, filename: nstr, size_bytes: nnum, error: nstr, uri: nstr }, ["file_id"])
		),
		image_errors: strArr,
		mcp_activity: arr(
			obj(
				{
					kind: { type: "string", enum: ["list_tools", "call"] },
					server_label: nstr,
					name: nstr,
					tools: strArr,
					arguments: nstr,
					output: { ...nstr, description: "Truncated to 500 chars." },
					error: nstr,
				},
				["kind"]
			)
		),
		cost_usd: nnum,
	},
	[
		"response_id",
		"status",
		"model",
		"effort",
		"service_tier",
		"output_text",
		"sources",
		"images",
		"pending_approvals",
		"shared_files",
		"image_errors",
		"mcp_activity",
		"cost_usd",
	]
);

export const OUTPUT_SCHEMAS: Record<string, JsonSchema> = {
	decisions: obj(
		{
			model: str,
			answers: {
				type: "object",
				description: "Keyed by question name. noul: {type,noul}; choice: {type,choice,confidence,probabilities}; score: {type,score,confidence,legend,probabilities}.",
				additionalProperties: obj(
					{
						type: str,
						noul: num,
						choice: str,
						score: num,
						confidence: num,
						probabilities: { type: "object", additionalProperties: num },
						legend: { type: "object" },
					},
					["type"]
				),
			},
			missing_answers: { ...strArr, description: "Question names the API returned no answer for." },
			usage: obj({ input_tokens: nint, output_tokens: nint, tool_calls: { type: "object", additionalProperties: int } }),
			estimated_cost_usd: nnum,
			search_results: arr(SOURCE),
			fetched_results: arr(obj({ title: nstr, url: str, chars: int }, ["url"])),
		},
		["model", "answers", "missing_answers", "estimated_cost_usd", "search_results", "fetched_results"]
	),

	raw_search: obj(
		{
			queries: strArr,
			count: int,
			results: arr(SOURCE),
		},
		["queries", "count", "results"]
	),

	list_models: obj(
		{
			provider_filter: nstr,
			count: int,
			models: arr(obj({ id: str, provider: str }, ["id", "provider"])),
		},
		["provider_filter", "count", "models"]
	),

	list_skills: obj(
		{
			mode: { type: "string", enum: ["list", "get"] },
			skills: {
				...arr(obj({ skill_id: str, name: nstr, revision: nstr, updated_at: nstr }, ["skill_id"])),
				description: "Present in list mode.",
			},
			skill: {
				...obj(
					{
						skill_id: str,
						name: nstr,
						description: nstr,
						revision: nstr,
						latest_revision: nstr,
						created_at: nstr,
						updated_at: nstr,
					},
					["skill_id"]
				),
				description: "Present in get mode (skill_id given).",
			},
			next_page_token: nstr,
		},
		["mode", "next_page_token"]
	),

	list_filters: obj(
		{
			allowed_domains: strArr,
			blocked_domains: strArr,
			recency: { ...nstr, description: "hour, day, week, month, year, or null." },
			max_domains: int,
		},
		["allowed_domains", "blocked_domains", "recency", "max_domains"]
	),

	agent_files: obj(
		{
			action: { type: "string", enum: ["list", "content"] },
			response_id: str,
			files: {
				...arr(
					obj({ file_id: str, filename: nstr, bytes: nnum, uri: str }, ["file_id", "uri"])
				),
				description: "list action. `uri` is readable via resources/read.",
			},
			file: {
				...obj(
					{ file_id: str, filename: nstr, bytes: int, mime_type: str, uri: str },
					["file_id", "bytes", "mime_type", "uri"]
				),
				description: "content action (the bytes are in the embedded resource block).",
			},
		},
		["action", "response_id"]
	),

	embeddings: obj(
		{
			...EMBEDDING_SUMMARY_PROPS,
			count: int,
			vectors: { ...strArr, description: "Base64 vectors, only with full: true." },
		},
		["model", "count", "dimensions", "dimensions_source", "encoding", "tokens", "cost_usd"]
	),

	contextualized_embeddings: obj(
		{
			...EMBEDDING_SUMMARY_PROPS,
			documents: int,
			chunks: int,
			vectors: {
				type: "array",
				items: strArr,
				description: "Base64 vectors per document, only with full: true.",
			},
		},
		["model", "documents", "chunks", "dimensions", "dimensions_source", "encoding", "tokens", "cost_usd"]
	),

	agent: AGENT_RUN_OUTPUT_SCHEMA,
	agent_retrieve: AGENT_RUN_OUTPUT_SCHEMA,

	search: obj(
		{
			answer: { ...str, description: "The synthesized answer (thinking stripped when strip_thinking)." },
			backend: { type: "string", enum: ["agent", "sonar"] },
			model: { ...str, description: "Routed Sonar model name (keyword routing / set_model)." },
			effort: { ...nstr, description: "Agent effort that ran, e.g. fast@2026-11-11.0 (agent backend)." },
			model_ran: { ...nstr, description: "Underlying model the Agent API reported (agent backend)." },
			status: nstr,
			sources: arr(SOURCE),
			images: arr(IMAGE),
			related_questions: strArr,
			cost_usd: { ...nnum, description: "Reported cost, independent of show_cost." },
			notes: { ...strArr, description: "Backend notes (dropped/approximated params)." },
		},
		["answer", "backend", "model", "effort", "model_ran", "status", "sources", "images", "related_questions", "cost_usd", "notes"]
	),

	get_model_info: obj(
		{
			current_model: str,
			default_model: str,
			auto_selection: { type: "boolean" },
			available_models: arr(obj({ id: str, description: str, keywords: strArr }, ["id"])),
		},
		["current_model", "default_model", "auto_selection", "available_models"]
	),

	async_research_status: obj(
		{
			request_id: str,
			backend: { type: "string", enum: ["agent", "legacy"] },
			status: { ...str, description: "Agent: queued/in_progress/completed/incomplete/failed/cancelled. Legacy: CREATED/IN_PROGRESS/COMPLETED/FAILED." },
			done: { type: "boolean", description: "false while the job is still running; poll again." },
			output_text: { ...str, description: "The report ('' until done)." },
			sources: arr(SOURCE),
			error: nstr,
			status_detail: nstr,
			notes: { ...strArr, description: "Backend notes recorded at submit (dropped/approximated params)." },
		},
		["request_id", "backend", "status", "done", "output_text", "sources", "error", "notes"]
	),

	async_research_list: obj(
		{
			jobs: {
				...arr(
					obj(
						{ request_id: str, status: str, model: nstr, effort: nstr, submitted_at: nstr, query: nstr },
						["request_id", "status"]
					)
				),
				description: "Jobs submitted through this server process (in-memory; lost on restart).",
			},
			legacy_jobs: arr(obj({ request_id: str, status: nstr, model: nstr }, ["request_id"])),
			legacy_error: { ...nstr, description: "Why the legacy async list was unavailable, if it was." },
		},
		["jobs", "legacy_jobs", "legacy_error"]
	),
};
