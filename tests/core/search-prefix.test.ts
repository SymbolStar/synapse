import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../../src/core/migrate";
import { indexParseResults } from "../../src/core/indexer";
import { search, buildFtsQuery } from "../../src/core/search";
import type { ParseResult } from "../../src/types";

function makePR(
	overrides: Partial<ParseResult["canonical"]> = {},
): ParseResult {
	return {
		canonical: {
			sessionKey: "prefix-1",
			source: "claude-code",
			startedAt: "2025-01-01T00:00:00Z",
			lastMessageAt: "2025-01-01T00:05:00Z",
			durationSeconds: 300,
			projectRef: "proj-abc",
			projectName: "my-project",
			model: "claude-sonnet-4-6",
			title: "Prefix test",
			totalInputTokens: 1000,
			totalOutputTokens: 500,
			totalCachedTokens: 0,
			messages: [
				{
					role: "user",
					content: "The hanging process caused crashes",
					timestamp: "2025-01-01T00:00:00Z",
				},
				{
					role: "assistant",
					content: "I fixed the deployment issue",
					timestamp: "2025-01-01T00:01:00Z",
				},
			],
			...overrides,
		},
	};
}

describe("buildFtsQuery", () => {
	test("appends * to each word", () => {
		expect(buildFtsQuery("hang fix")).toBe("hang* fix*");
	});

	test("preserves FTS operators", () => {
		expect(buildFtsQuery("hang AND fix")).toBe("hang* AND fix*");
		expect(buildFtsQuery("hang OR fix")).toBe("hang* OR fix*");
		expect(buildFtsQuery("NOT broken")).toBe("NOT broken*");
	});

	test("strips quotes and parentheses", () => {
		expect(buildFtsQuery('"hello" (world)')).toBe("hello* world*");
	});

	test("handles empty input", () => {
		expect(buildFtsQuery("")).toBe("");
	});
});

describe("prefix matching in search", () => {
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

	test("'hang' matches 'hanging'", () => {
		const results = search(db, { query: "hang" });
		expect(results.length).toBeGreaterThanOrEqual(1);
		expect(results[0].snippet).toContain("hang");
	});

	test("'deploy' matches 'deployment'", () => {
		const results = search(db, { query: "deploy" });
		expect(results.length).toBeGreaterThanOrEqual(1);
	});

	test("'crash' matches 'crashes'", () => {
		const results = search(db, { query: "crash" });
		expect(results.length).toBeGreaterThanOrEqual(1);
	});
});
