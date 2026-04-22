import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../../src/core/migrate";
import { indexParseResults } from "../../src/core/indexer";
import type { ParseResult } from "../../src/types";

function makePR(overrides: Partial<ParseResult["canonical"]> = {}): ParseResult {
	return {
		canonical: {
			sessionKey: "sess-1",
			source: "claude-code",
			startedAt: "2025-01-01T00:00:00Z",
			lastMessageAt: "2025-01-01T00:05:00Z",
			durationSeconds: 300,
			projectRef: "proj-abc",
			projectName: "my-project",
			model: "claude-sonnet-4-6",
			title: "Test session",
			totalInputTokens: 1000,
			totalOutputTokens: 500,
			totalCachedTokens: 0,
			messages: [
				{ role: "user", content: "Hello", timestamp: "2025-01-01T00:00:00Z" },
				{
					role: "assistant",
					content: "Hi there!",
					model: "claude-sonnet-4-6",
					timestamp: "2025-01-01T00:01:00Z",
					inputTokens: 500,
					outputTokens: 250,
				},
				{
					role: "tool",
					content: "file contents",
					toolName: "Read",
					timestamp: "2025-01-01T00:02:00Z",
				},
			],
			...overrides,
		},
	};
}

describe("indexer", () => {
	let db: Database;

	beforeEach(() => {
		db = new Database(":memory:");
		db.exec("PRAGMA journal_mode = WAL");
		db.exec("PRAGMA foreign_keys = ON");
		runMigrations(db);
	});

	afterEach(() => {
		db.close();
	});

	test("inserts project, session, and messages correctly", () => {
		const result = indexParseResults(db, [makePR()]);

		expect(result.indexed).toBe(1);
		expect(result.skipped).toBe(0);

		const project = db.query("SELECT * FROM projects WHERE id = 'proj-abc'").get() as any;
		expect(project.name).toBe("my-project");

		const session = db.query("SELECT * FROM sessions WHERE id = 'sess-1'").get() as any;
		expect(session.source).toBe("claude-code");
		expect(session.project_id).toBe("proj-abc");
		expect(session.duration_seconds).toBe(300);
		expect(session.message_count).toBe(3);
		expect(session.user_message_count).toBe(1);
		expect(session.total_input_tokens).toBe(1000);
		expect(session.total_output_tokens).toBe(500);

		const messages = db
			.query("SELECT * FROM messages WHERE session_id = 'sess-1' ORDER BY ordinal")
			.all() as any[];
		expect(messages).toHaveLength(3);
		expect(messages[0].role).toBe("user");
		expect(messages[1].role).toBe("assistant");
		expect(messages[2].role).toBe("tool");
		expect(messages[2].tool_name).toBe("Read");
	});

	test("re-indexing same session updates without duplicates", () => {
		indexParseResults(db, [makePR()]);
		indexParseResults(db, [
			makePR({
				title: "Updated title",
				messages: [
					{ role: "user", content: "New message", timestamp: "2025-01-01T00:00:00Z" },
				],
			}),
		]);

		const sessions = db.query("SELECT * FROM sessions").all();
		expect(sessions).toHaveLength(1);
		expect((sessions[0] as any).title).toBe("Updated title");

		const messages = db.query("SELECT * FROM messages").all();
		expect(messages).toHaveLength(1);
	});

	test("FTS index is populated", () => {
		indexParseResults(db, [makePR()]);

		const ftsResults = db
			.query("SELECT * FROM messages_fts WHERE messages_fts MATCH 'Hello'")
			.all() as any[];
		expect(ftsResults).toHaveLength(1);
		expect(ftsResults[0].content).toBe("Hello");

		const toolResults = db
			.query("SELECT * FROM messages_fts WHERE messages_fts MATCH 'Read'")
			.all() as any[];
		expect(toolResults).toHaveLength(1);
	});

	test("multiple sessions in one call", () => {
		const results = indexParseResults(db, [
			makePR({ sessionKey: "sess-a" }),
			makePR({ sessionKey: "sess-b", title: "Second session" }),
		]);

		expect(results.indexed).toBe(2);

		const sessions = db.query("SELECT * FROM sessions ORDER BY id").all();
		expect(sessions).toHaveLength(2);

		const messages = db.query("SELECT * FROM messages").all();
		expect(messages).toHaveLength(6);
	});

	test("skips sessions with no messages", () => {
		const result = indexParseResults(db, [makePR({ messages: [] })]);
		expect(result.indexed).toBe(0);
		expect(result.skipped).toBe(1);
	});
});
