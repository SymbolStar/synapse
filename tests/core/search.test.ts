import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../../src/core/migrate";
import { indexParseResults } from "../../src/core/indexer";
import {
	search,
	listSessions,
	getSessionDetail,
	getProjectSummary,
} from "../../src/core/search";
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
				{
					role: "assistant",
					content: "Hi there!",
					model: "claude-sonnet-4-6",
					timestamp: "2025-01-01T00:01:00Z",
					inputTokens: 500,
					outputTokens: 250,
				},
			],
			...overrides,
		},
	};
}

function seedData(db: Database) {
	indexParseResults(db, [
		makePR(),
		makePR({
			sessionKey: "sess-2",
			source: "opencode",
			projectRef: "proj-xyz",
			projectName: "other-project",
			title: "Opencode session",
			startedAt: "2025-01-02T00:00:00Z",
			lastMessageAt: "2025-01-02T00:05:00Z",
			messages: [
				{
					role: "user",
					content: "Fix the database migration",
					timestamp: "2025-01-02T00:00:00Z",
				},
				{
					role: "assistant",
					content: "Done fixing migration",
					timestamp: "2025-01-02T00:01:00Z",
				},
			],
		}),
		makePR({
			sessionKey: "sess-3",
			source: "claude-code",
			projectRef: "proj-abc",
			projectName: "my-project",
			title: "Another session",
			startedAt: "2025-01-03T00:00:00Z",
			lastMessageAt: "2025-01-03T00:10:00Z",
			messages: [
				{
					role: "user",
					content: "Deploy the application",
					timestamp: "2025-01-03T00:00:00Z",
				},
			],
		}),
	]);
}

describe("search engine", () => {
	let db: Database;

	beforeEach(() => {
		db = new Database(":memory:");
		db.exec("PRAGMA journal_mode = WAL");
		db.exec("PRAGMA foreign_keys = ON");
		runMigrations(db);
		seedData(db);
	});

	afterEach(() => {
		db.close();
	});

	describe("search", () => {
		test("finds matching content", () => {
			const results = search(db, { query: "Hello" });
			expect(results.length).toBeGreaterThanOrEqual(1);
			expect(results[0].sessionKey).toBe("sess-1");
		});

		test("returns snippet with match", () => {
			const results = search(db, { query: "migration" });
			expect(results.length).toBeGreaterThanOrEqual(1);
			expect(results[0].snippet).toContain("migration");
		});

		test("respects source filter", () => {
			const results = search(db, {
				query: "Hello OR migration OR Deploy",
				source: "opencode",
			});
			for (const r of results) {
				expect(r.source).toBe("opencode");
			}
		});

		test("respects project filter", () => {
			const results = search(db, {
				query: "Hello OR migration OR Deploy",
				project: "other-project",
			});
			for (const r of results) {
				expect(r.projectName).toBe("other-project");
			}
		});

		test("respects since filter", () => {
			const results = search(db, {
				query: "Hello OR migration OR Deploy",
				since: "2025-01-02T00:00:00Z",
			});
			for (const r of results) {
				expect(r.sessionKey).not.toBe("sess-1");
			}
		});

		test("respects limit", () => {
			const results = search(db, {
				query: "Hello OR migration OR Deploy",
				limit: 1,
			});
			expect(results).toHaveLength(1);
		});
	});

	describe("listSessions", () => {
		test("returns sessions ordered by started_at DESC", () => {
			const sessions = listSessions(db);
			expect(sessions).toHaveLength(3);
			expect(sessions[0].id).toBe("sess-3");
			expect(sessions[1].id).toBe("sess-2");
			expect(sessions[2].id).toBe("sess-1");
		});

		test("filters by source", () => {
			const sessions = listSessions(db, { source: "opencode" });
			expect(sessions).toHaveLength(1);
			expect(sessions[0].source).toBe("opencode");
		});

		test("filters by project", () => {
			const sessions = listSessions(db, { project: "other" });
			expect(sessions).toHaveLength(1);
			expect(sessions[0].projectName).toBe("other-project");
		});

		test("filters by since", () => {
			const sessions = listSessions(db, {
				since: "2025-01-02T00:00:00Z",
			});
			expect(sessions).toHaveLength(2);
		});

		test("respects limit", () => {
			const sessions = listSessions(db, { limit: 2 });
			expect(sessions).toHaveLength(2);
		});
	});

	describe("getSessionDetail", () => {
		test("returns session with messages in order", () => {
			const detail = getSessionDetail(db, "sess-1");
			expect(detail).not.toBeNull();
			expect(detail!.id).toBe("sess-1");
			expect(detail!.messages).toHaveLength(2);
			expect(detail!.messages[0].role).toBe("user");
			expect(detail!.messages[1].role).toBe("assistant");
			expect(detail!.messages[0].ordinal).toBe(0);
			expect(detail!.messages[1].ordinal).toBe(1);
		});

		test("returns null for missing session", () => {
			const detail = getSessionDetail(db, "nonexistent");
			expect(detail).toBeNull();
		});
	});

	describe("getProjectSummary", () => {
		test("returns correct counts", () => {
			const summary = getProjectSummary(db, { days: 3650 });
			expect(summary.totalSessions).toBe(3);
			expect(summary.bySource["claude-code"]).toBe(2);
			expect(summary.bySource["opencode"]).toBe(1);
			expect(summary.recentSessions.length).toBeGreaterThanOrEqual(1);
		});

		test("filters by project", () => {
			const summary = getProjectSummary(db, {
				project: "other",
				days: 3650,
			});
			expect(summary.totalSessions).toBe(1);
			expect(summary.bySource["opencode"]).toBe(1);
		});

		test("filters by days", () => {
			const summary = getProjectSummary(db, { days: 0 });
			expect(summary.totalSessions).toBe(0);
		});
	});
});
