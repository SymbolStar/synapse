import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { writeFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDatabase, closeDatabase } from "../../src/core/db";
import { runMigrations } from "../../src/core/migrate";
import { ClaudeCodeAdapter } from "../../src/adapters/claude-code/adapter";
import { runSync } from "../../src/core/sync";
import { search, listSessions, getSessionDetail } from "../../src/core/search";
import type { CursorState } from "../../src/types";
import type { Database } from "bun:sqlite";

function jsonl(...lines: object[]): string {
	return lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
}

function userLine(sid: string, text: string, ts: string) {
	return {
		type: "user",
		sessionId: sid,
		uuid: `u-${sid}-${ts}`,
		parentUuid: null,
		timestamp: ts,
		message: { role: "user", content: text },
	};
}

function assistantLine(sid: string, text: string, ts: string) {
	return {
		type: "assistant",
		sessionId: sid,
		uuid: `a-${sid}-${ts}`,
		timestamp: ts,
		message: {
			role: "assistant",
			model: "claude-sonnet-4-20250514",
			content: [{ type: "text", text }],
			usage: { input_tokens: 200, output_tokens: 100 },
		},
	};
}

describe("e2e integration", () => {
	let tmpDir: string;
	let dbPath: string;
	let db: Database;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "synapse-e2e-"));
		dbPath = join(tmpDir, "test.db");
		db = openDatabase(dbPath);
		runMigrations(db);
	});

	afterEach(() => {
		closeDatabase(db);
		rmSync(tmpDir, { recursive: true, force: true });
	});

	test("full pipeline: sync → search → session detail → incremental skip", async () => {
		// Setup: two project dirs with JSONL fixtures
		const projectA = join(tmpDir, "projects", "-tmp-projectA");
		const projectB = join(tmpDir, "projects", "-tmp-projectB");
		mkdirSync(projectA, { recursive: true });
		mkdirSync(projectB, { recursive: true });

		writeFileSync(
			join(projectA, "session1.jsonl"),
			jsonl(
				userLine("s1", "How do I parse JSON in TypeScript?", "2025-01-15T10:00:00Z"),
				assistantLine("s1", "Use JSON.parse() to parse a JSON string.", "2025-01-15T10:00:05Z"),
				userLine("s1", "What about error handling?", "2025-01-15T10:01:00Z"),
				assistantLine("s1", "Wrap it in a try-catch block.", "2025-01-15T10:01:05Z"),
			),
		);

		writeFileSync(
			join(projectB, "session2.jsonl"),
			jsonl(
				userLine("s2", "Explain SQLite FTS5 full-text search", "2025-01-16T09:00:00Z"),
				assistantLine("s2", "FTS5 is a virtual table module for full-text search.", "2025-01-16T09:00:10Z"),
			),
		);

		const adapter = new ClaudeCodeAdapter(join(tmpDir, "projects"));
		const cursors: CursorState = { files: {}, updatedAt: "" };

		// Step 1: Sync
		const result = await runSync(db, [adapter], cursors);
		expect(result.totalFiles).toBe(2);
		expect(result.totalParsed).toBeGreaterThanOrEqual(2);
		expect(result.totalSkipped).toBe(0);
		expect(result.errors).toHaveLength(0);

		// Step 2: Search
		const hits = search(db, { query: "JSON" });
		expect(hits.length).toBeGreaterThanOrEqual(1);
		expect(hits.some((h) => h.snippet.includes("JSON"))).toBe(true);

		// Step 3: List sessions
		const sessions = listSessions(db);
		expect(sessions.length).toBe(2);

		// Step 4: Session detail
		const detail = getSessionDetail(db, sessions[0].id);
		expect(detail).not.toBeNull();
		expect(detail!.messages.length).toBeGreaterThanOrEqual(1);

		// Step 5: Incremental — sync again, files should be skipped
		const result2 = await runSync(db, [adapter], cursors);
		expect(result2.totalSkipped).toBe(2);
		expect(result2.totalParsed).toBe(0);
	});

	test("search returns results from correct project", async () => {
		const projDir = join(tmpDir, "projects", "-tmp-myproject");
		mkdirSync(projDir, { recursive: true });

		writeFileSync(
			join(projDir, "chat.jsonl"),
			jsonl(
				userLine("s3", "Deploy the Kubernetes cluster", "2025-02-01T08:00:00Z"),
				assistantLine("s3", "Run kubectl apply to deploy.", "2025-02-01T08:00:10Z"),
			),
		);

		const adapter = new ClaudeCodeAdapter(join(tmpDir, "projects"));
		const cursors: CursorState = { files: {}, updatedAt: "" };
		await runSync(db, [adapter], cursors);

		const hits = search(db, { query: "Kubernetes" });
		expect(hits.length).toBe(1);

		const noHits = search(db, { query: "nonexistent_xyz_term" });
		expect(noHits.length).toBe(0);
	});
});
