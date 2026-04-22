import type { Database } from "bun:sqlite";
import { listSessions, type SessionListFilters } from "../../core/search";
import type { Source } from "../../types";

interface SessionListArgs {
	source?: Source;
	project?: string;
	since?: string;
	limit?: number;
}

export function handleSessionList(args: SessionListArgs, db: Database) {
	const sessions = listSessions(db, args as SessionListFilters);

	if (sessions.length === 0) {
		return { content: [{ type: "text" as const, text: "No sessions found." }] };
	}

	const lines = sessions.map((s) => {
		const project = s.projectName ? ` ${s.projectName}` : "";
		const title = s.title ? ` — ${s.title}` : "";
		return `[${s.source}]${project}${title}\n  ID: ${s.id} | ${s.startedAt} | ${s.messageCount} msgs | ${s.totalInputTokens + s.totalOutputTokens} tokens`;
	});

	return {
		content: [{ type: "text" as const, text: lines.join("\n\n") }],
	};
}
