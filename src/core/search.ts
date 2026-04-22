import type { Database } from "bun:sqlite";
import type { SearchResult, Source } from "../types";

export interface SearchFilters {
	query: string;
	source?: Source;
	project?: string;
	since?: string;
	tag?: string;
	limit?: number;
}

export interface SessionSummary {
	id: string;
	source: Source;
	projectId: string | null;
	projectName: string | null;
	title: string | null;
	model: string | null;
	startedAt: string;
	endedAt: string | null;
	durationSeconds: number;
	messageCount: number;
	totalInputTokens: number;
	totalOutputTokens: number;
}

export interface SessionDetail extends SessionSummary {
	messages: {
		ordinal: number;
		role: string;
		content: string;
		toolName: string | null;
		model: string | null;
		timestamp: string | null;
		inputTokens: number;
		outputTokens: number;
	}[];
}

export interface SessionListFilters {
	source?: Source;
	project?: string;
	since?: string;
	limit?: number;
}

export interface ProjectSummary {
	totalSessions: number;
	bySource: Record<string, number>;
	recentSessions: SessionSummary[];
}

function clampLimit(limit?: number): number {
	const n = limit ?? 10;
	return Math.max(1, Math.min(n, 100));
}

const FTS_OPERATORS = new Set(["AND", "OR", "NOT", "NEAR"]);

export function buildFtsQuery(raw: string): string {
	const sanitized = raw.replace(/[""''()]/g, "");
	return sanitized
		.split(/\s+/)
		.filter((w) => w.length > 0)
		.map((w) => (FTS_OPERATORS.has(w) ? w : `${w}*`))
		.join(" ");
}

export function search(db: Database, filters: SearchFilters): SearchResult[] {
	const params: unknown[] = [];
	const conditions: string[] = [];
	let paramIdx = 1;

	conditions.push(`messages_fts MATCH ?${paramIdx}`);
	params.push(buildFtsQuery(filters.query));
	paramIdx++;

	if (filters.source) {
		conditions.push(`s.source = ?${paramIdx}`);
		params.push(filters.source);
		paramIdx++;
	}

	if (filters.project) {
		conditions.push(`p.name LIKE ?${paramIdx}`);
		params.push(`%${filters.project}%`);
		paramIdx++;
	}

	if (filters.since) {
		conditions.push(`s.started_at >= ?${paramIdx}`);
		params.push(filters.since);
		paramIdx++;
	}

	let tagJoin = "";
	if (filters.tag) {
		tagJoin = `JOIN tags t ON t.session_id = s.id AND t.tag = ?${paramIdx}`;
		params.push(filters.tag);
		paramIdx++;
	}

	const limit = clampLimit(filters.limit);
	params.push(limit);

	const sql = `
		SELECT
			s.id AS sessionId,
			s.id AS sessionKey,
			s.source,
			p.name AS projectName,
			s.title,
			snippet(messages_fts, 0, '>>>', '<<<', '...', 32) AS snippet,
			m.timestamp
		FROM messages_fts
		JOIN messages m ON m.rowid = messages_fts.rowid
		JOIN sessions s ON m.session_id = s.id
		LEFT JOIN projects p ON s.project_id = p.id
		${tagJoin}
		WHERE ${conditions.join(" AND ")}
		ORDER BY rank
		LIMIT ?${paramIdx}
	`;

	const rows = db.query(sql).all(...params) as any[];
	return rows.map((r) => ({
		sessionId: 0,
		sessionKey: r.sessionKey,
		source: r.source as Source,
		projectName: r.projectName ?? undefined,
		title: r.title ?? undefined,
		snippet: r.snippet,
		timestamp: r.timestamp,
	}));
}

function rowToSummary(r: any): SessionSummary {
	return {
		id: r.id,
		source: r.source as Source,
		projectId: r.project_id,
		projectName: r.projectName ?? r.project_name ?? null,
		title: r.title,
		model: r.model,
		startedAt: r.started_at,
		endedAt: r.ended_at,
		durationSeconds: r.duration_seconds,
		messageCount: r.message_count,
		totalInputTokens: r.total_input_tokens,
		totalOutputTokens: r.total_output_tokens,
	};
}

export function listSessions(
	db: Database,
	filters: SessionListFilters = {},
): SessionSummary[] {
	const params: unknown[] = [];
	const conditions: string[] = [];
	let paramIdx = 1;

	if (filters.source) {
		conditions.push(`s.source = ?${paramIdx}`);
		params.push(filters.source);
		paramIdx++;
	}

	if (filters.project) {
		conditions.push(`p.name LIKE ?${paramIdx}`);
		params.push(`%${filters.project}%`);
		paramIdx++;
	}

	if (filters.since) {
		conditions.push(`s.started_at >= ?${paramIdx}`);
		params.push(filters.since);
		paramIdx++;
	}

	const limit = clampLimit(filters.limit);
	params.push(limit);

	const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

	const sql = `
		SELECT s.*, p.name AS projectName
		FROM sessions s
		LEFT JOIN projects p ON s.project_id = p.id
		${where}
		ORDER BY s.started_at DESC
		LIMIT ?${paramIdx}
	`;

	const rows = db.query(sql).all(...params) as any[];
	return rows.map(rowToSummary);
}

export function getSessionDetail(
	db: Database,
	sessionId: string,
): SessionDetail | null {
	const row = db
		.query(
			`SELECT s.*, p.name AS projectName
			 FROM sessions s
			 LEFT JOIN projects p ON s.project_id = p.id
			 WHERE s.id = ?1`,
		)
		.get(sessionId) as any;

	if (!row) return null;

	const messages = db
		.query(
			`SELECT ordinal, role, content, tool_name, model, timestamp, input_tokens, output_tokens
			 FROM messages WHERE session_id = ?1 ORDER BY ordinal`,
		)
		.all(sessionId) as any[];

	return {
		...rowToSummary(row),
		messages: messages.map((m) => ({
			ordinal: m.ordinal,
			role: m.role,
			content: m.content,
			toolName: m.tool_name,
			model: m.model,
			timestamp: m.timestamp,
			inputTokens: m.input_tokens,
			outputTokens: m.output_tokens,
		})),
	};
}

export function getProjectSummary(
	db: Database,
	filters: { project?: string; days?: number } = {},
): ProjectSummary {
	const days = filters.days ?? 7;
	const since = new Date(Date.now() - days * 86400000).toISOString();

	const params: unknown[] = [since];
	const conditions: string[] = ["s.started_at >= ?1"];
	let paramIdx = 2;

	if (filters.project) {
		conditions.push(`p.name LIKE ?${paramIdx}`);
		params.push(`%${filters.project}%`);
		paramIdx++;
	}

	const where = conditions.join(" AND ");

	const countRow = db
		.query(
			`SELECT COUNT(*) AS total FROM sessions s
			 LEFT JOIN projects p ON s.project_id = p.id
			 WHERE ${where}`,
		)
		.get(...params) as any;

	const bySourceRows = db
		.query(
			`SELECT s.source, COUNT(*) AS cnt FROM sessions s
			 LEFT JOIN projects p ON s.project_id = p.id
			 WHERE ${where}
			 GROUP BY s.source`,
		)
		.all(...params) as any[];

	const bySource: Record<string, number> = {};
	for (const r of bySourceRows) {
		bySource[r.source] = r.cnt;
	}

	params.push(5);
	const recentRows = db
		.query(
			`SELECT s.*, p.name AS projectName FROM sessions s
			 LEFT JOIN projects p ON s.project_id = p.id
			 WHERE ${where}
			 ORDER BY s.started_at DESC
			 LIMIT ?${paramIdx}`,
		)
		.all(...params) as any[];

	return {
		totalSessions: countRow.total,
		bySource,
		recentSessions: recentRows.map(rowToSummary),
	};
}

export interface DbStats {
	totalSessions: number;
	totalMessages: number;
	dbSizeBytes: number;
	bySource: Record<string, number>;
}

export function getStats(db: Database): DbStats {
	const sess = db.query("SELECT COUNT(*) AS c FROM sessions").get() as any;
	const msgs = db.query("SELECT COUNT(*) AS c FROM messages").get() as any;

	const bySourceRows = db
		.query("SELECT source, COUNT(*) AS cnt FROM sessions GROUP BY source")
		.all() as any[];
	const bySource: Record<string, number> = {};
	for (const r of bySourceRows) bySource[r.source] = r.cnt;

	let dbSizeBytes = 0;
	try {
		const sizeRow = db
			.query("SELECT page_count * page_size AS size FROM pragma_page_count(), pragma_page_size()")
			.get() as any;
		dbSizeBytes = sizeRow?.size ?? 0;
	} catch {
		dbSizeBytes = 0;
	}

	return {
		totalSessions: sess.c,
		totalMessages: msgs.c,
		dbSizeBytes,
		bySource,
	};
}
