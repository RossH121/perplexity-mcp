/**
 * Handler for the list_skills tool: read-only access to the project's custom
 * (managed) skills, client.skills.list (GET /v1/skills) and
 * client.skills.retrieve (GET /v1/skills/{id}). Lets callers find the
 * `skill_...` ids the agent tool's custom skills take. Upload/delete are out
 * of scope (they need multipart ZIP bundles and optimistic concurrency).
 */

import { McpRequest, HandlerContext, SkillsArgs } from "../schemas/types.js";
import { isValidSkillsArgs } from "../schemas/validation.js";
import { PerplexityApiService } from "../services/PerplexityApiService.js";
import { ErrorHandler } from "../utils/errorHandling.js";
import { structuredResult, strOrNull } from "../utils/structuredResult.js";

const field = (label: string, v: unknown): string | null =>
	v === undefined || v === null || v === "" ? null : `${label}: ${v}`;

export class SkillsHandler {
	constructor(private apiService: PerplexityApiService) {}

	async handle(request: McpRequest, ctx: HandlerContext = {}) {
		const raw = request.params.arguments ?? {};
		if (!isValidSkillsArgs(raw)) {
			throw ErrorHandler.validationError(
				"Invalid list_skills arguments. 'skill_id', 'revision' and 'page_token' must be non-empty strings, 'limit' a positive integer, and 'revision' requires 'skill_id'."
			);
		}
		const args = raw as SkillsArgs;

		try {
			if (args.skill_id !== undefined) {
				const s = await this.apiService.getSkill(args.skill_id, args.revision, ctx);
				const lines = [
					`## Skill ${s?.skill_id ?? args.skill_id}`,
					field("Name", s?.name),
					field("Description", s?.description),
					field("Revision", s?.revision),
					field("Latest revision", s?.latest_revision),
					field("Created", s?.created_at),
					field("Updated", s?.updated_at),
					"",
					`_Use in the agent tool as skills: [{ type: "custom", id: "${s?.skill_id ?? args.skill_id}" }]._`,
				].filter((l): l is string => l !== null);
				const skill = {
					skill_id: strOrNull(s?.skill_id) ?? args.skill_id,
					name: strOrNull(s?.name),
					description: strOrNull(s?.description),
					revision: strOrNull(s?.revision),
					latest_revision: strOrNull(s?.latest_revision),
					created_at: strOrNull(s?.created_at),
					updated_at: strOrNull(s?.updated_at),
				};
				return structuredResult(lines.join("\n"), { mode: "get", skill, next_page_token: null });
			}

			const resp = await this.apiService.listSkills(args, ctx);
			const skills: any[] = resp?.skills ?? [];
			const lines: string[] = ["## Custom Skills", ""];
			if (skills.length === 0) {
				lines.push(
					"No custom skills in this project. Custom skills are uploaded as ZIP bundles (one SKILL.md) via the Perplexity API or portal; builtin skills (office, office/docx, office/pdf, office/pptx, office/xlsx) need no id."
				);
			} else {
				for (const s of skills) {
					const meta = [s.revision && `rev ${s.revision}`, s.updated_at && `updated ${s.updated_at}`]
						.filter(Boolean)
						.join(", ");
					lines.push(`- **${s.name ?? "(unnamed)"}**: \`${s.skill_id}\`${meta ? ` (${meta})` : ""}`);
				}
				lines.push("", '_Pass an id to the agent tool as skills: [{ type: "custom", id }], or call list_skills with skill_id for details._');
			}
			if (resp?.next_page_token) lines.push("", `More results: call again with page_token "${resp.next_page_token}".`);
			return structuredResult(lines.join("\n"), {
				mode: "list",
				skills: skills
					.filter((s) => strOrNull(s?.skill_id))
					.map((s) => ({
						skill_id: strOrNull(s.skill_id),
						name: strOrNull(s.name),
						revision: strOrNull(s.revision),
						updated_at: strOrNull(s.updated_at),
					})),
				next_page_token: strOrNull(resp?.next_page_token),
			});
		} catch (error) {
			return ErrorHandler.handleApiError(error);
		}
	}
}
