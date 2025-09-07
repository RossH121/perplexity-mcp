/**
 * Environment configuration for the Perplexity MCP server
 */

import { VALID_MODELS, ValidModel } from "../schemas/types.js";

export class EnvironmentConfig {
	public readonly apiKey: string;
	public readonly defaultModel: ValidModel;

	constructor() {
		this.apiKey = this.getRequiredEnvVar("PERPLEXITY_API_KEY");
		this.defaultModel = this.getValidatedModel();
	}

	private getRequiredEnvVar(name: string): string {
		const value = process.env[name];
		if (!value) {
			throw new Error(`${name} environment variable is required`);
		}
		return value;
	}

	private getValidatedModel(): ValidModel {
		const modelFromEnv = process.env.PERPLEXITY_MODEL || "sonar-pro";
		
		if (!VALID_MODELS.includes(modelFromEnv as ValidModel)) {
			throw new Error(
				`Invalid default model '${modelFromEnv}'. Valid models are: ${VALID_MODELS.join(", ")}`
			);
		}
		
		return modelFromEnv as ValidModel;
	}
}