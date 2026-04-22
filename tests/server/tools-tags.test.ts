import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../../src/core/migrate";
import { indexParseResults } from "../../src/core/indexer";
import { handleTag } from "../../src/server/tools/tags";
import { addTag } from "../../src/core/tags";
import type { ParseResult } from "../../src/types";

function makePR(
	overrides: Partial<ParseResult["canonical"]> = {},
): ParseResult {
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
				{
					role: "user",
					content: "Hello world",
					timestamp: "2025-01-01T00:00:00Z",
				},
			],
			...overrides,
		},
	};
}

describe("handleTag", () => {
	let db: Database;

	beforeEach(() => {
		db = new Database(":memory:");
		db.exec("PRAGMA journal_mode = WAL");
		db.exec("PRAGMA foreign_keys = ON");
		runMigrations(db);
		indexParseResults(db, [makePR()]);
	});

	afterEach(() => {
		db.close();
	});

	test("add tag", () => {
		const res = handleTag({ action: "add", session_id: "sess-1", tag: "bug-fix" }, db);
		expect(res.content[0].text).toContain("#bug-fix");
	});

	test("list tags", () => {
		addTag(db, "sess-1", "bug-fix");
		addTag(db, "sess-1", "reusable");
		const res = handleTag({ action: "list", session_id: "sess-1" }, db);
		expect(res.content[0].text).toContain("#bug-fix");
		expect(res.content[0].text).toContain("#reusable");
	});

	test("list empty tags", () => {
		const res = handleTag({ action: "list", session_id: "sess-1" }, db);
		expect(res.content[0].text).toBe("No tags for this session.");
	});

	test("remove tag", () => {
		addTag(db, "sess-1", "bug-fix");
		const res = handleTag({ action: "remove", session_id: "sess-1", tag: "bug-fix" }, db);
		expect(res.content[0].text).toContain("Removed");
	});

	test("search by tag", () => {
		addTag(db, "sess-1", "good-solution");
		const res = handleTag({ action: "search", tag: "good-solution" }, db);
		expect(res.content[0].text).toContain("sess-1");
	});

	test("search with no results", () => {
		const res = handleTag({ action: "search", tag: "nonexistent" }, db);
		expect(res.content[0].text).toBe("No sessions found with that tag.");
	});

	test("missing session_id for add", () => {
		const res = handleTag({ action: "add", tag: "bug-fix" }, db);
		expect(res.content[0].text).toContain("Missing");
	});

	test("missing tag for add", () => {
		const res = handleTag({ action: "add", session_id: "sess-1" }, db);
		expect(res.content[0].text).toContain("Missing");
	});

	test("missing tag for search", () => {
		const res = handleTag({ action: "search" }, db);
		expect(res.content[0].text).toContain("Missing");
	});
});
