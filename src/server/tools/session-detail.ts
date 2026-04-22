import type { Database } from "bun:sqlite";
import { getSessionDetail } from "../../core/search";

interface SessionDetailArgs {
	session_id: string;
	roles?: string[];
	summary_only?: boolean;
}

export function handleSessionDetail(args: SessionDetailArgs, db: Database) {
	const detail = getSessionDetail(db, args.session_id);

	if (!detail) {
		return { content: [{ type: "text" as const, text: `Session '${args.session_id}' not found.` }] };
	}

	const header = `[${detail.source}] ${detail.projectName ?? ""}${detail.title ? ` — ${detail.title}` : ""}
Started: ${detail.startedAt} | Duration: ${detail.durationSeconds}s | ${detail.messageCount} msgs
Tokens: ${detail.totalInputTokens} in / ${detail.totalOutputTokens} out`;

	if (args.summary_only) {
		return { content: [{ type: "text" as const, text: header }] };
	}

	let messages = detail.messages;
	if (args.roles && args.roles.length > 0) {
		messages = messages.filter((m) => args.roles!.includes(m.role));
	}

	const conversation = messages
		.map((m) => {
			const role = m.role.toUpperCase();
			const tool = m.toolName ? ` (${m.toolName})` : "";
			return `[${role}${tool}] ${m.content}`;
		})
		.join("\n\n");

	return {
		content: [{ type: "text" as const, text: `${header}\n\n${conversation}` }],
	};
}
