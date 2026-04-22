import type { Database } from "bun:sqlite";
import type { Source } from "../types";

export function addTag(db: Database, sessionId: string, tag: string): void {
	db.query(
		"INSERT OR IGNORE INTO tags (session_id, tag) VALUES (?1, ?2)",
	).run(sessionId, tag);
}

export function removeTag(db: Database, sessionId: string, tag: string): void {
	db.query("DELETE FROM tags WHERE session_id = ?1 AND tag = ?2").run(
		sessionId,
		tag,
	);
}

export function listTags(db: Database, sessionId: string): string[] {
	const rows = db
		.query("SELECT tag FROM tags WHERE session_id = ?1 ORDER BY tag")
		.all(sessionId) as { tag: string }[];
	return rows.map((r) => r.tag);
}

export interface TagSearchResult {
	sessionId: string;
	source: Source;
	projectName: string | null;
	title: string | null;
	startedAt: string;
	tags: string[];
}

export function searchByTag(
	db: Database,
	tag: string,
	limit?: number,
): TagSearchResult[] {
	const n = Math.max(1, Math.min(limit ?? 10, 100));
	const rows = db
		.query(
			`SELECT s.id, s.source, p.name AS projectName, s.title, s.started_at
			 FROM tags t
			 JOIN sessions s ON t.session_id = s.id
			 LEFT JOIN projects p ON s.project_id = p.id
			 WHERE t.tag = ?1
			 ORDER BY s.started_at DESC
			 LIMIT ?2`,
		)
		.all(tag, n) as any[];

	return rows.map((r) => ({
		sessionId: r.id,
		source: r.source as Source,
		projectName: r.projectName,
		title: r.title,
		startedAt: r.started_at,
		tags: listTags(db, r.id),
	}));
}
