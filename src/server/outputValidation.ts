/**
 * Server-side check of structuredContent against each tool's outputSchema.
 *
 * The low-level SDK Server (v2, like v1) never validates structuredContent
 * against outputSchema; only McpServer.registerTool does. The SDK Client does
 * (Ajv 2020-12 by default in v2, after tools/list) and THROWS on a
 * mismatch or on a missing structuredContent, losing the whole result. So a
 * schema drift is caught here instead and downgraded to an isError result that
 * still carries the text, with structuredContent dropped (isError results are
 * exempt from validation on both sides).
 */

import { AjvJsonSchemaValidator } from "@modelcontextprotocol/server/validators/ajv";
import { logError } from "../utils/logger.js";

type Tool = { name: string; outputSchema?: Record<string, unknown> };
type Validator = (input: unknown) => { valid: boolean; errorMessage?: string };

export function createOutputChecker(tools: readonly Tool[]) {
	const ajv = new AjvJsonSchemaValidator();
	const validators = new Map<string, Validator>();
	for (const t of tools) {
		if (t.outputSchema) validators.set(t.name, ajv.getValidator(t.outputSchema as any) as Validator);
	}

	return function checkOutput(toolName: string, result: any): any {
		const validate = validators.get(toolName);
		if (!validate || !result || typeof result !== "object" || result.isError) return result;

		let problem: string | undefined;
		if (!result.structuredContent || typeof result.structuredContent !== "object") {
			problem = "no structuredContent was returned";
		} else {
			const r = validate(result.structuredContent);
			if (!r.valid) problem = r.errorMessage ?? "structuredContent does not match outputSchema";
		}
		if (!problem) return result;

		logError(`outputSchema violation in ${toolName}: ${problem}`);
		const { structuredContent: _dropped, ...rest } = result;
		const content = Array.isArray(rest.content) ? rest.content : [];
		return {
			...rest,
			content: [
				...content,
				{
					type: "text",
					text: `[perplexity-mcp internal error: the ${toolName} result failed its outputSchema (${problem}). The text above is still the real result; please report this.]`,
				},
			],
			isError: true,
		};
	};
}
