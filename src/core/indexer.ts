import type { Database } from "bun:sqlite";
import type { ParseResult } from "../types";

export interface IndexResult {
	indexed: number;
	skipped: number;
}

export function indexParseResults(
	db: Database,
	results: ParseResult[],
): IndexResult {
	let indexed = 0;
	let skipped = 0;

	const upsertProject = db.prepare(`
		INSERT INTO projects (id, path, name, last_activity, session_count)
		VALUES (?1, ?2, ?3, ?4, 1)
		ON CONFLICT(id) DO UPDATE SET
			name = ?3,
			last_activity = MAX(COALESCE(last_activity, ''), ?4),
			session_count = session_count + 1
	`);

	const upsertSession = db.prepare(`
		INSERT OR REPLACE INTO sessions
			(id, source, project_id, title, model, started_at, ended_at,
			 duration_seconds, message_count, user_message_count,
			 total_input_tokens, total_output_tokens, indexed_at)
		VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
	`);

	const deleteMessages = db.prepare(
		"DELETE FROM messages WHERE session_id = ?",
	);

	const insertMessage = db.prepare(`
		INSERT INTO messages (id, session_id, ordinal, role, content, tool_name, model, timestamp, input_tokens, output_tokens)
		VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
	`);

	const indexAll = db.transaction(() => {
		for (const result of results) {
			const s = result.canonical;

			if (!s.sessionKey || s.messages.length === 0) {
				skipped++;
				continue;
			}

			const projectId = s.projectRef ?? null;
			if (projectId && s.projectName) {
				upsertProject.run(
					projectId,
					s.projectName,
					s.projectName,
					s.lastMessageAt,
				);
			}

			const now = new Date().toISOString();
			const userMsgCount = s.messages.filter(
				(m) => m.role === "user",
			).length;

			upsertSession.run(
				s.sessionKey,
				s.source,
				projectId,
				s.title ?? null,
				s.model ?? null,
				s.startedAt,
				s.lastMessageAt,
				s.durationSeconds,
				s.messages.length,
				userMsgCount,
				s.totalInputTokens,
				s.totalOutputTokens,
				now,
			);

			deleteMessages.run(s.sessionKey);

			for (let i = 0; i < s.messages.length; i++) {
				const m = s.messages[i];
				const msgId = `${s.sessionKey}:${i}`;
				insertMessage.run(
					msgId,
					s.sessionKey,
					i,
					m.role,
					m.content,
					m.toolName ?? null,
					m.model ?? null,
					m.timestamp,
					m.inputTokens ?? 0,
					m.outputTokens ?? 0,
				);
			}

			indexed++;
		}
	});

	indexAll();

	return { indexed, skipped };
}
