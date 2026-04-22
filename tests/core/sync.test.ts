import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runMigrations } from "../../src/core/migrate";
import { runSync } from "../../src/core/sync";
import { ClaudeCodeAdapter } from "../../src/adapters/claude-code/adapter";
import type { CursorState } from "../../src/types";

function jsonl(...lines: object[]): string {
	return lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
}

function makeUserLine(sessionId: string, content: string, ts: string) {
	return {
		type: "user",
		sessionId,
		uuid: `u-${sessionId}-${ts}`,
		parentUuid: null,
		timestamp: ts,
		message: { role: "user", content },
	};
}

function makeAssistantLine(sessionId: string, content: string, ts: string) {
	return {
		type: "assistant",
		sessionId,
		uuid: `a-${sessionId}-${ts}`,
		timestamp: ts,
		message: {
			role: "assistant",
			model: "claude-sonnet-4-6",
			content,
			usage: { input_tokens: 100, output_tokens: 50 },
		},
	};
}

let tmpDir: string;
let db: Database;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "sync-test-"));
	db = new Database(":memory:");
	db.exec("PRAGMA journal_mode = WAL");
	db.exec("PRAGMA foreign_keys = ON");
	runMigrations(db);
});

afterEach(() => {
	db.close();
	rmSync(tmpDir, { recursive: true, force: true });
});

function emptyCursors(): CursorState {
	return { files: {}, updatedAt: new Date().toISOString() };
}

function writeFixture(name: string, content: string): string {
	// Mimic claude projects dir structure: tmpDir/projects/-test-project/file.jsonl
	const projectDir = join(tmpDir, "projects", "-test-project");
	mkdirSync(projectDir, { recursive: true });
	const filePath = join(projectDir, name);
	writeFileSync(filePath, content);
	return filePath;
}

describe("sync orchestrator", () => {
	test("syncs sessions from claude adapter and indexes them", async () => {
		const data = jsonl(
			makeUserLine("s1", "Hello world", "2025-01-01T00:00:00Z"),
			makeAssistantLine("s1", "Hi!", "2025-01-01T00:01:00Z"),
		);
		writeFixture("session1.jsonl", data);

		const adapter = new ClaudeCodeAdapter(tmpDir);
		const cursors = emptyCursors();
		const result = await runSync(db, [adapter], cursors);

		expect(result.totalFiles).toBe(1);
		expect(result.totalParsed).toBeGreaterThanOrEqual(1);
		expect(result.totalSkipped).toBe(0);
		expect(result.errors).toHaveLength(0);

		// Verify sessions indexed
		const sessions = db.query("SELECT * FROM sessions").all() as any[];
		expect(sessions.length).toBeGreaterThanOrEqual(1);

		// Verify cursors updated
		const keys = Object.keys(cursors.files);
		expect(keys.length).toBe(1);
	});

	test("second run skips unchanged files", async () => {
		const data = jsonl(
			makeUserLine("s1", "Hello", "2025-01-01T00:00:00Z"),
			makeAssistantLine("s1", "Hi!", "2025-01-01T00:01:00Z"),
		);
		writeFixture("session1.jsonl", data);

		const adapter = new ClaudeCodeAdapter(tmpDir);
		const cursors = emptyCursors();

		await runSync(db, [adapter], cursors);
		const result2 = await runSync(db, [adapter], cursors);

		expect(result2.totalSkipped).toBe(1);
		expect(result2.totalParsed).toBe(0);
	});

	test("error on bad file does not stop sync", async () => {
		// Write a valid file
		const good = jsonl(
			makeUserLine("s1", "Hello", "2025-01-01T00:00:00Z"),
			makeAssistantLine("s1", "Hi!", "2025-01-01T00:01:00Z"),
		);
		writeFixture("good.jsonl", good);

		// Write a corrupt file
		const projectDir = join(tmpDir, "projects", "-test-project");
		writeFileSync(join(projectDir, "bad.jsonl"), "{{not json\n");

		const adapter = new ClaudeCodeAdapter(tmpDir);
		const cursors = emptyCursors();
		const result = await runSync(db, [adapter], cursors);

		expect(result.totalFiles).toBe(2);
		// At least the good file should have been processed
		expect(result.totalParsed + result.totalSkipped).toBeGreaterThanOrEqual(1);
		// Errors collected but sync continued
		expect(result.errors.length).toBeLessThanOrEqual(1);
	});

	test("source filter limits adapters", async () => {
		const data = jsonl(
			makeUserLine("s1", "Hello", "2025-01-01T00:00:00Z"),
			makeAssistantLine("s1", "Hi!", "2025-01-01T00:01:00Z"),
		);
		writeFixture("session1.jsonl", data);

		const adapter = new ClaudeCodeAdapter(tmpDir);
		const cursors = emptyCursors();

		// Filter to non-matching source
		const result = await runSync(db, [adapter], cursors, {
			source: "opencode",
		});
		expect(result.totalFiles).toBe(0);
	});
});
