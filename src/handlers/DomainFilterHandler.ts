/**
 * Handler for domain filter tool functionality
 */

import { McpRequest, DomainArgs } from "../schemas/types.js";
import { isValidDomainArgs } from "../schemas/validation.js";
import { FilterState } from "../models/FilterState.js";
import { ErrorHandler } from "../utils/errorHandling.js";
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";

export class DomainFilterHandler {
	constructor(private filterState: FilterState) {}

	async handle(request: McpRequest) {
		if (!isValidDomainArgs(request.params.arguments)) {
			throw ErrorHandler.createMcpError(
				ErrorCode.InvalidParams,
				'Invalid domain filter arguments. Domain must be a non-empty string and action must be "allow" or "block".'
			);
		}

		const { domain, action } = request.params.arguments as DomainArgs;
		const resultMessage = this.filterState.setDomainFilter(domain, action);

		return {
			content: [
				{
					type: "text",
					text: resultMessage,
				},
			],
		};
	}
}