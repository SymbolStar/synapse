import type { Database } from "bun:sqlite";
import { search, type SearchFilters } from "../../core/search";
import type { Source } from "../../types";

interface SearchArgs {
	query: string;
	source?: Source;
	project?: string;
	since?: string;
	tag?: string;
	limit?: number;
}

export function handleSearch(args: SearchArgs, db: Database) {
	const results = search(db, args as SearchFilters);

	if (results.length === 0) {
		return { content: [{ type: "text" as const, text: "No results found." }] };
	}

	const lines = results.map((r) => {
		const source = `[${r.source}]`;
		const project = r.projectName ? ` ${r.projectName}` : "";
		const title = r.title ? ` — ${r.title}` : "";
		const snippet = r.snippet.replace(/\n/g, " ");
		return `${source}${project}${title}\n  Session: ${r.sessionKey}\n  ${snippet}\n  ${r.timestamp ?? ""}`;
	});

	return {
		content: [{ type: "text" as const, text: lines.join("\n\n") }],
	};
}
