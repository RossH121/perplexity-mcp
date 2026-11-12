/**
 * Handler for the agent_retrieve tool — polls a background Agent API run by id
 * (client.responses.retrieve). Renders with the same formatter as the `agent`
 * tool so a completed job looks identical whether it ran inline or queued.
 */

import { McpRequest, HandlerContext, AgentRetrieveArgs } from "../schemas/types.js";
import { isValidAgentRetrieveArgs } from "../schemas/validation.js";
import { PerplexityApiService } from "../services/PerplexityApiService.js";
import { ErrorHandler } from "../utils/errorHandling.js";
import { agentResult } from "./AgentHandler.js";

export class AgentRetrieveHandler {
	constructor(private apiService: PerplexityApiService) {}

	async handle(request: McpRequest, ctx: HandlerContext = {}) {
		if (!isValidAgentRetrieveArgs(request.params.arguments)) {
			throw ErrorHandler.validationError(
				"Invalid agent_retrieve arguments. 'response_id' must be a non-empty string."
			);
		}

		const args = request.params.arguments as AgentRetrieveArgs;

		try {
			const resp = await this.apiService.getAgentResponse(args.response_id, ctx);
			return agentResult(resp);
		} catch (error) {
			return ErrorHandler.handleApiError(error);
		}
	}
}
