import type { Database } from "bun:sqlite";
import { search } from "../../core/search";
import type { Source } from "../../types";

interface RelatedArgs {
	context: string;
	project?: string;
	limit?: number;
}

export function handleRelated(args: RelatedArgs, db: Database) {
	const results = search(db, {
		query: args.context,
		project: args.project,
		limit: args.limit ?? 5,
	});

	if (results.length === 0) {
		return { content: [{ type: "text" as const, text: "No related sessions found." }] };
	}

	const lines = results.map((r) => {
		const source = `[${r.source}]`;
		const project = r.projectName ? ` ${r.projectName}` : "";
		const title = r.title ? ` — ${r.title}` : "";
		const snippet = r.snippet.replace(/\n/g, " ");
		return `${source}${project}${title}\n  Session: ${r.sessionKey}\n  ${snippet}`;
	});

	return {
		content: [{ type: "text" as const, text: lines.join("\n\n") }],
	};
}
