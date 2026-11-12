/**
 * In-process registry of agent sandbox files this server has seen (via
 * agent_files list/content or resources/read). Backs resources/list; the
 * resource template + resources/read work for any file id, listed or not.
 * Per server instance, insertion-ordered, capped (oldest evicted).
 */

import { agentFileUri } from "../utils/agentFileUri.js";

export interface AgentFileEntry {
	uri: string;
	responseId: string;
	fileId: string;
	filename?: string;
	bytes?: number;
	mimeType?: string;
}

const MAX_ENTRIES = 200;

export class AgentFileRegistry {
	private entries = new Map<string, AgentFileEntry>();

	/** @param onAdded fired when a NEW uri is registered (drives resources/list_changed). */
	constructor(private onAdded: () => void = () => {}) {}

	record(responseId: string, fileId: string, meta: { filename?: string; bytes?: number; mimeType?: string } = {}): string {
		const uri = agentFileUri(responseId, fileId);
		const prev = this.entries.get(uri);
		const clean = Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined && v !== null));
		this.entries.set(uri, { ...prev, uri, responseId, fileId, ...clean });
		if (!prev) {
			while (this.entries.size > MAX_ENTRIES) {
				const oldest = this.entries.keys().next().value;
				if (oldest === undefined) break;
				this.entries.delete(oldest);
			}
			this.onAdded();
		}
		return uri;
	}

	list(): AgentFileEntry[] {
		return [...this.entries.values()];
	}
}
