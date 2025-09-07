# Perplexity MCP Server

An MCP server that provides web search capabilities using Perplexity's API with automatic model selection based on query intent.

<a href="https://glama.ai/mcp/servers/6qmvjay9z5">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/6qmvjay9z5/badge" alt="Perplexity Server MCP server" />
</a>

## Prerequisites

- Node.js (v14 or higher)
- A Perplexity API key (get one at <https://www.perplexity.ai/settings/api>)
- Claude Desktop App

## Installation

### Installing via Git

1. Clone this repository:

    ```bash
    git clone https://github.com/RossH121/perplexity-mcp.git
    cd perplexity-mcp
    ```

2. Install dependencies:

    ```bash
    npm install
    ```

3. Build the server:

    ```bash
    npm run build
    ```

## Configuration

1. Get your Perplexity API key from <https://www.perplexity.ai/settings/api>

2. Add the server to Claude's config file at `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "perplexity-server": {
      "command": "node",
      "args": [
        "/absolute/path/to/perplexity-mcp/build/index.js"
      ],
      "env": {
        "PERPLEXITY_API_KEY": "your-api-key-here",
        "PERPLEXITY_MODEL": "sonar"
      }
    }
  }
}
```

Replace `/absolute/path/to` with the actual path to where you cloned the repository.

### Available Models

The server now supports automatic model selection based on query intent, but you can also specify a default model using the `PERPLEXITY_MODEL` environment variable. Available options:

- `sonar-deep-research` - Specialized for extensive research and expert-level analysis across domains
- `sonar-reasoning-pro` - Optimized for advanced logical reasoning and complex problem-solving
- `sonar-reasoning` - Designed for reasoning tasks with balanced performance
- `sonar-pro` - General-purpose model with excellent search capabilities and citation density
- `sonar` - Fast and efficient for straightforward queries

The default model (specified in the environment variable) will be used as the baseline for automatic model selection.

For up-to-date model pricing and availability, visit: <https://docs.perplexity.ai/guides/pricing>

## Usage

After configuring the server and restarting Claude, you can simply ask Claude to search for information. For example:

- "What's the latest news about SpaceX?"
- "Search for the best restaurants in Chicago"
- "Find information about the history of jazz music"
- "I need a deep research analysis of recent AI developments" (uses sonar-deep-research)
- "Help me reason through this complex problem" (uses sonar-reasoning-pro)

Claude will automatically use the Perplexity search tool to find and return relevant information. The server will automatically select the most appropriate model based on your query's intent.

If for whatever reason it decides not to use the search tool, you can force the issue by prepending your prompt with "Search the web".

### Intelligent Model Selection

The server automatically selects the most appropriate Perplexity model based on your query:

- Use research-oriented terms like "deep research," "comprehensive," or "in-depth" to trigger sonar-deep-research
- Use reasoning terms like "solve," "figure out," or "complex problem" to trigger sonar-reasoning-pro
- Use simple terms like "quick," "brief," or "basic" to trigger the lightweight sonar model
- General search terms default to sonar-pro for balanced performance

Each search response includes information about which model was used and why.

### Domain Filtering

This server supports domain filtering to customize your search experience. You can allow or block specific domains using these commands:

- **Add an allowed domain**: "Use the domain_filter tool to allow wikipedia.org"
- **Add a blocked domain**: "Use the domain_filter tool to block pinterest.com"
- **View current filters**: "Use the list_filters tool" (shows domain and recency filters)
- **Clear all filters**: "Use the clear_filters tool" (clears both domain and recency filters)

**Note**: Perplexity API supports up to 3 domains total with priority given to allowed domains. Domain filtering requires a Perplexity API tier that supports this feature.

Example usage flow:
1. "Use the domain_filter tool to allow wikipedia.org"
2. "Use the domain_filter tool to allow arxiv.org"
3. "Use the list_filters tool" (to verify your settings)
4. "Search for quantum computing advances" (results will prioritize wikipedia.org and arxiv.org)

### Recency Filtering

You can limit search results to a specific time window using the recency filter:

- **Set recency filter**: "Use the recency_filter tool with filter=hour" (options: hour, day, week, month)
- **Disable recency filter**: "Use the recency_filter tool with filter=none"

This is particularly useful for time-sensitive queries like current events or breaking news.

### Model Selection Control

While the automatic model selection works well for most cases, you can manually control which model is used:

- **View model information**: "Use the model_info tool"
- **Set a specific model**: "Use the model_info tool with model=sonar-deep-research"
- **Return to automatic selection**: Set the model back to the default model

Example usage:
1. "Use the model_info tool" (to see available models and current status)
2. "Use the model_info tool with model=sonar-reasoning-pro" (to force using reasoning model)
3. "Search for a mathematical proof of the Pythagorean theorem" (will use sonar-reasoning-pro)
4. "Use the model_info tool with model=sonar-pro" (to return to automatic selection)

## Development

To modify the server:

1. Edit `src/index.ts`
2. Rebuild with `npm run build`
3. Restart Claude to load the changes

## License

MIT