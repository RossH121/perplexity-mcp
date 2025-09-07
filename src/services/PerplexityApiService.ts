/**
 * Service for communicating with the Perplexity AI API
 */

import axios, { type AxiosInstance } from "axios";
import { SearchResponse, ApiParams } from "../schemas/types.js";
import { API_CONFIG } from "../config/constants.js";
import { EnvironmentConfig } from "../config/environment.js";

export class PerplexityApiService {
	private axiosInstance: AxiosInstance;

	constructor(private config: EnvironmentConfig) {
		this.axiosInstance = axios.create({
			baseURL: API_CONFIG.BASE_URL,
			headers: {
				Authorization: `Bearer ${this.config.apiKey}`,
				"Content-Type": "application/json",
			},
		});
	}

	/**
	 * Performs a search using the Perplexity API
	 */
	async search(apiParams: ApiParams): Promise<SearchResponse> {
		const response = await this.axiosInstance.post<SearchResponse>(
			"/chat/completions",
			apiParams,
		);
		return response.data;
	}

	/**
	 * Handles streaming search responses
	 */
	async searchStream(apiParams: ApiParams): Promise<string> {
		const response = await this.axiosInstance.post(
			"/chat/completions",
			apiParams,
			{
				responseType: 'stream',
				timeout: API_CONFIG.TIMEOUT,
			}
		);

		let fullContent = '';

		// Process the streaming response
		for await (const chunk of response.data) {
			const lines = chunk.toString().split('\n');
			
			for (const line of lines) {
				if (line.startsWith('data: ')) {
					const data = line.slice(6).trim();
					
					if (data === '[DONE]') {
						break;
					}
					
					if (data) {
						try {
							const parsed = JSON.parse(data);
							const content = parsed.choices[0]?.delta?.content;
							
							if (content) {
								fullContent += content;
							}
						} catch (parseError) {
							// Skip malformed chunks
							continue;
						}
					}
				}
			}
		}

		return fullContent;
	}

	/**
	 * Creates API parameters for a search request
	 */
	createApiParams(
		model: string,
		query: string,
		domainFilters?: string[],
		recencyFilter?: string,
		stream?: boolean
	): ApiParams {
		const apiParams: ApiParams = {
			model,
			messages: [
				{
					role: "system",
					content: "You are a helpful assistant that searches the web for accurate information.",
				},
				{
					role: "user",
					content: query,
				},
			],
		};

		// Only add search_domain_filter if we have domains to filter
		if (domainFilters && domainFilters.length > 0) {
			apiParams.search_domain_filter = domainFilters;
		}

		// Add recency filter if set
		if (recencyFilter) {
			apiParams.search_recency_filter = recencyFilter;
		}

		// Add stream parameter if requested
		if (stream) {
			apiParams.stream = true;
		}

		return apiParams;
	}
}