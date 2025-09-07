/**
 * Service for intelligent model selection based on query intent
 */

import { ModelSelection } from "../schemas/types.js";
import { MODEL_SELECTION_MAP } from "../config/constants.js";
import { EnvironmentConfig } from "../config/environment.js";

export class ModelSelectionService {
	constructor(private config: EnvironmentConfig) {}

	/**
	 * Selects the most appropriate model based on the user's query text
	 */
	selectModelBasedOnIntent(query: string): ModelSelection {
		// Convert query to lowercase for case-insensitive matching
		const lowercaseQuery = query.toLowerCase();

		// Calculate scores for each model based on keyword matches
		const modelScores = Object.entries(MODEL_SELECTION_MAP).map(
			([model, criteria]) => {
				const score = criteria.keywords.reduce((total, keyword) => {
					// Add 1 to the score for each keyword that appears in the query
					return total + (lowercaseQuery.includes(keyword.toLowerCase()) ? 1 : 0);
				}, 0);

				return {
					model,
					score,
					description: criteria.description,
				};
			},
		);

		// Sort models by score (descending)
		modelScores.sort((a, b) => b.score - a.score);

		// If no keywords matched or all scores are 0, use the default model
		if (modelScores[0].score === 0) {
			return {
				model: this.config.defaultModel,
				description: MODEL_SELECTION_MAP[this.config.defaultModel].description,
				score: 0,
			};
		}

		// Return the model with the highest score
		return {
			model: modelScores[0].model,
			description: modelScores[0].description,
			score: modelScores[0].score,
		};
	}

	/**
	 * Gets the description for a specific model
	 */
	getModelDescription(model: string): string {
		return MODEL_SELECTION_MAP[model]?.description || "Unknown model";
	}
}