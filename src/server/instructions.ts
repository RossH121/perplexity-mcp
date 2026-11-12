/**
 * Server `instructions` sent in the MCP initialize result.
 *
 * Claude Code truncates this at 4,096 characters and, with tool search on,
 * loads only tool names plus this text upfront, so it must say when to reach
 * for these tools. Key points first. Describe the tools only; do not add
 * directives about how the client model should behave in general.
 * Keep it accurate to the current code; tests assert the length limit.
 */

export const SERVER_INSTRUCTIONS = `Perplexity web search, research, agent, decision and embedding tools. search and async_research_submit run on the Perplexity Agent API by default (Sonar Chat Completions reached end of support on 2026-09-27).

Choosing a tool:
- search: one AI-synthesized answer with cited sources. The default for factual, current-events and documentation questions. Uses only the query text, not conversation history.
- raw_search: ranked URLs, titles and snippets with no LLM synthesis; up to 5 queries per call. Cheaper and faster; suits source discovery and fact-checking pipelines.
- agent: multi-step Agent API runs with built-in tools (web_search, fetch_url, people_search, finance_search, image_search, sandbox), remote MCP servers (optionally approval-gated), skills, image and document input, structured output and third-party models (list_models gives current ids; list_skills gives custom skill ids). background:true queues a run: poll it with agent_retrieve, stop it with agent_cancel. agent_files lists and downloads files a run shared; they are also readable as perplexity-agent-file:// resources.
- async_research_submit / async_research_status / async_research_list: long research as a background job. submit returns an id, status polls it (the id also works with agent_retrieve and agent_cancel), list covers jobs from this server process only.
- decisions: calibrated probabilities instead of prose for named questions about supplied content: noul (P(yes)), choice (pick an option), score (ordered rubric). Suits classification, gating and fact-checks; mode "web_grounding" searches the web first. Returns no rationale text.
- embeddings / contextualized_embeddings: vector embeddings; the contextualized variant takes chunks grouped per document.

How search picks its depth: query keywords select a Sonar model, which maps to an Agent effort level. "deep research", "comprehensive", "thorough", "in-depth" or "expert" select sonar-deep-research (effort high: slowest, most expensive); "reasoning", "solve", "analyze", "think" and similar select sonar-reasoning-pro (low); "quick", "simple", "brief" select sonar (fast); anything else uses the default model (sonar-pro, fast, unless PERPLEXITY_MODEL changes it). search's effort param (fast/low/medium/high/xhigh/ultra) bypasses routing for one call. set_model pins a model for later calls (a strong keyword match still overrides it; "auto" restores routing); get_model_info shows the selection. Each answer's header names the model and effort that ran. Sonar-only params with no Agent equivalent are ignored and listed under "Backend notes".

Filters: search takes per-call search_domain_filter (max 20; a '-' prefix excludes; one list is all-allow or all-exclude), recency, and published/last-updated date filters. They apply to that call only and override any stateful filter. raw_search takes the same kinds of filters.

Deprecated: domain_filter, recency_filter, clear_filters and list_filters hold shared state that applies to every later search in this server process; per-call params replace them. async_research (replaced by async_research_submit/_status/_list) and model_info (replaced by get_model_info/set_model; with no arguments it resets the selection) are aliases due for removal.

Cost and side effects: search, raw_search, agent, async_research_submit, decisions and both embeddings tools are billed per call, and higher effort levels cost more. The status, retrieve, list and file tools read existing results. The filter and model-state tools are local and make no API call. agent runs can execute tools on remote MCP servers. agent_cancel stops a run irreversibly. search with show_cost appends the request cost.`;
