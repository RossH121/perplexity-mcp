/**
 * Handler for the agent_cancel tool, requests cancellation of an in-progress
 * agent run (client.responses.cancel). Mainly useful for background runs that
 * are taking too long or were submitted by mistake.
 */

import { McpRequest, HandlerContext, AgentCancelArgs } from "../schemas/types.js";
import { isValidAgentCancelArgs } from "../schemas/validation.js";
import { PerplexityApiService } from "../services/PerplexityApiService.js";
import { ErrorHandler } from "../utils/errorHandling.js";

export class AgentCancelHandler {
	constructor(private apiService: PerplexityApiService) {}

	async handle(request: McpRequest, ctx: HandlerContext = {}) {
		if (!isValidAgentCancelArgs(request.params.arguments)) {
			throw ErrorHandler.validationError(
				"Invalid agent_cancel arguments. 'response_id' must be a non-empty string."
			);
		}

		const args = request.params.arguments as AgentCancelArgs;

		try {
			const result = await this.apiService.cancelAgentResponse(args.response_id, ctx);
			const id = result?.response_id ?? args.response_id;
			const status = result?.status ?? "cancelling";
			return {
				content: [
					{
						type: "text",
						text: `Cancellation requested for ${id}. Status: ${status}.\n\nCancellation is asynchronous, poll with agent_retrieve to see the final status.`,
					},
				],
			};
		} catch (error) {
			return ErrorHandler.handleApiError(error);
		}
	}
}
