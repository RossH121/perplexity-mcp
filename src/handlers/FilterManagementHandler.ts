/**
 * Handler for filter management tools (clear_filters, list_filters)
 */

import { FilterState } from "../models/FilterState.js";

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
		const statusMessage = this.filterState.getFilterStatus();

		return {
			content: [
				{
					type: "text",
					text: statusMessage,
				},
			],
		};
	}
}