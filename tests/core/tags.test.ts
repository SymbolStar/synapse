import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../../src/core/migrate";
import { indexParseResults } from "../../src/core/indexer";
import { addTag, removeTag, listTags, searchByTag } from "../../src/core/tags";
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

describe("tags", () => {
	let db: Database;

	beforeEach(() => {
		db = new Database(":memory:");
		db.exec("PRAGMA journal_mode = WAL");
		db.exec("PRAGMA foreign_keys = ON");
		runMigrations(db);
		indexParseResults(db, [
			makePR(),
			makePR({
				sessionKey: "sess-2",
				source: "opencode",
				projectRef: "proj-xyz",
				projectName: "other-project",
				title: "Second session",
				startedAt: "2025-01-02T00:00:00Z",
				lastMessageAt: "2025-01-02T00:05:00Z",
			}),
		]);
	});

	afterEach(() => {
		db.close();
	});

	test("addTag and listTags", () => {
		addTag(db, "sess-1", "bug-fix");
		addTag(db, "sess-1", "reusable");
		expect(listTags(db, "sess-1")).toEqual(["bug-fix", "reusable"]);
	});

	test("addTag ignores duplicates", () => {
		addTag(db, "sess-1", "bug-fix");
		addTag(db, "sess-1", "bug-fix");
		expect(listTags(db, "sess-1")).toEqual(["bug-fix"]);
	});

	test("removeTag", () => {
		addTag(db, "sess-1", "bug-fix");
		addTag(db, "sess-1", "reusable");
		removeTag(db, "sess-1", "bug-fix");
		expect(listTags(db, "sess-1")).toEqual(["reusable"]);
	});

	test("removeTag no-op for missing tag", () => {
		removeTag(db, "sess-1", "nonexistent");
		expect(listTags(db, "sess-1")).toEqual([]);
	});

	test("listTags returns empty for untagged session", () => {
		expect(listTags(db, "sess-1")).toEqual([]);
	});

	test("searchByTag finds tagged sessions", () => {
		addTag(db, "sess-1", "good-solution");
		addTag(db, "sess-2", "good-solution");
		const results = searchByTag(db, "good-solution");
		expect(results).toHaveLength(2);
		expect(results[0].sessionId).toBe("sess-2"); // newer first
		expect(results[1].sessionId).toBe("sess-1");
	});

	test("searchByTag respects limit", () => {
		addTag(db, "sess-1", "good-solution");
		addTag(db, "sess-2", "good-solution");
		const results = searchByTag(db, "good-solution", 1);
		expect(results).toHaveLength(1);
	});

	test("searchByTag returns empty for unknown tag", () => {
		expect(searchByTag(db, "nonexistent")).toEqual([]);
	});

	test("searchByTag includes tags in results", () => {
		addTag(db, "sess-1", "good-solution");
		addTag(db, "sess-1", "reusable");
		const results = searchByTag(db, "good-solution");
		expect(results[0].tags).toEqual(["good-solution", "reusable"]);
	});
});
