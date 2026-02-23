/**
 * State management for domain and recency filters
 */

import { DomainFilters } from "../schemas/types.js";
import { API_CONFIG } from "../config/constants.js";

export class FilterState {
	private domainFilters: DomainFilters = {
		allowedDomains: [],
		blockedDomains: [],
	};
	private recencyFilter: string | null = null;

	/**
	 * Add a domain to allow or block list
	 */
	setDomainFilter(domain: string, action: "allow" | "block"): string {
		// Clean the domain input - remove any protocol prefixes
		const cleanDomain = domain
			.replace(/^https?:\/\//, "")
			.split("/")[0]
			.trim();

		if (action === "allow") {
			// Remove from blocked if it exists there
			this.domainFilters.blockedDomains = this.domainFilters.blockedDomains.filter(
				(d) => d !== cleanDomain
			);

			// Add to allowed if not already there
			if (!this.domainFilters.allowedDomains.includes(cleanDomain)) {
				this.domainFilters.allowedDomains.push(cleanDomain);
			}

			return `Added ${cleanDomain} to allowed domains. Search results will prioritize this domain.`;
		} else {
			// Remove from allowed if it exists there
			this.domainFilters.allowedDomains = this.domainFilters.allowedDomains.filter(
				(d) => d !== cleanDomain
			);

			// Add to blocked if not already there
			if (!this.domainFilters.blockedDomains.includes(cleanDomain)) {
				this.domainFilters.blockedDomains.push(cleanDomain);
			}

			return `Added ${cleanDomain} to blocked domains. Search results will exclude this domain.`;
		}
	}

	/**
	 * Set recency filter
	 */
	setRecencyFilter(filter: string): string {
		if (filter === "none") {
			this.recencyFilter = null;
			return "Recency filter has been disabled. Searches will include results from any time period.";
		}

		this.recencyFilter = filter;
		const timeDescription = {
			hour: "hour",
			day: "24 hours",
			week: "7 days",
			month: "30 days",
			year: "year",
		}[filter] || filter;

		return `Recency filter set to "${filter}". Searches will be limited to content from the last ${timeDescription}.`;
	}

	/**
	 * Clear all filters
	 */
	clearFilters(): string {
		this.domainFilters = {
			allowedDomains: [],
			blockedDomains: [],
		};
		this.recencyFilter = null;

		return "All domain and recency filters have been cleared. Searches will use default Perplexity sources.";
	}

	/**
	 * Get current filter status
	 */
	getFilterStatus(): string {
		const allowedText =
			this.domainFilters.allowedDomains.length > 0
				? `Allowed domains: ${this.domainFilters.allowedDomains.join(", ")}`
				: "No allowed domains configured.";

		const blockedText =
			this.domainFilters.blockedDomains.length > 0
				? `Blocked domains: ${this.domainFilters.blockedDomains.join(", ")}`
				: "No blocked domains configured.";

		const recencyText = this.recencyFilter
			? `Recency filter: ${this.recencyFilter} (limiting to content from the last ${
					{
						hour: "hour",
						day: "24 hours",
						week: "7 days",
						month: "30 days",
						year: "year",
					}[this.recencyFilter] || this.recencyFilter
				})`
			: "No recency filter configured.";

		const limitText =
			`Note: Perplexity API supports up to ${API_CONFIG.MAX_DOMAINS} domains total with priority given to allowed domains.`;

		return `Current filters:\n\n${allowedText}\n${blockedText}\n${recencyText}\n\n${limitText}`;
	}

	/**
	 * Get domain filter array for API calls
	 */
	getDomainFilterArray(): string[] {
		const domainFilterArray: string[] = [];

		// Add allowed domains (up to max)
		const allowedDomainsToUse = this.domainFilters.allowedDomains.slice(0, API_CONFIG.MAX_DOMAINS);
		for (const domain of allowedDomainsToUse) {
			domainFilterArray.push(domain);
		}

		// Add blocked domains (up to remaining slots from max total)
		const remainingSlots = API_CONFIG.MAX_DOMAINS - domainFilterArray.length;
		const blockedDomainsToUse = this.domainFilters.blockedDomains.slice(
			0,
			remainingSlots,
		);
		for (const domain of blockedDomainsToUse) {
			domainFilterArray.push(`-${domain}`);
		}

		return domainFilterArray;
	}

	/**
	 * Get current recency filter
	 */
	getRecencyFilter(): string | null {
		return this.recencyFilter;
	}
}