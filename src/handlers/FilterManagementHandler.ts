/**
 * Handler for filter management tools (clear_filters, list_filters)
 */

import { FilterState } from "../models/FilterState.js";
import { structuredResult } from "../utils/structuredResult.js";

export class FilterManagementHandler {
	constructor(private filterState: FilterState) {}

	async handleClearFilters() {
		const resultMessage = this.filterState.clearFilters();

		return {
			content: [
				{
					type: "text",
					text: resultMessage,
				},
			],
		};
	}

	async handleListFilters() {
		return structuredResult(this.filterState.getFilterStatus(), this.filterState.snapshot());
	}
}