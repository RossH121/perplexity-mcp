/**
 * Handler for recency filter tool functionality
 */

import { McpRequest, HandlerContext, RecencyArgs } from "../schemas/types.js";
import { isValidRecencyArgs } from "../schemas/validation.js";
import { FilterState } from "../models/FilterState.js";
import { ErrorHandler } from "../utils/errorHandling.js";

export class RecencyFilterHandler {
	constructor(private filterState: FilterState) {}

	async handle(request: McpRequest, ctx: HandlerContext = {}) {
		if (!isValidRecencyArgs(request.params.arguments)) {
			throw ErrorHandler.validationError(
				"Invalid recency filter argument. Filter must be one of: hour, day, week, month, none."
			);
		}

		const { filter } = request.params.arguments as RecencyArgs;
		const resultMessage = this.filterState.setRecencyFilter(filter);

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