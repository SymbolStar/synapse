import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../../src/core/migrate";
import { indexParseResults } from "../../src/core/indexer";
import { handleSearch } from "../../src/server/tools/search";
import { handleSessionList } from "../../src/server/tools/session-list";
import { handleSessionDetail } from "../../src/server/tools/session-detail";
import { handleSync } from "../../src/server/tools/sync";
import { handleRelated } from "../../src/server/tools/related";
import { handleProjectSummary } from "../../src/server/tools/project-summary";
import type { ParseResult, CursorState } from "../../src/types";
import type { SourceAdapter } from "../../src/adapters/types";

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
	]);
}

describe("MCP tool handlers", () => {
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

	describe("handleSearch", () => {
		test("returns formatted results", () => {
			const res = handleSearch({ query: "Hello" }, db);
			expect(res.content).toHaveLength(1);
			expect(res.content[0].type).toBe("text");
			expect(res.content[0].text).toContain("sess-1");
			expect(res.content[0].text).toContain("[claude-code]");
		});

		test("returns no results message", () => {
			const res = handleSearch({ query: "nonexistent_xyz" }, db);
			expect(res.content[0].text).toBe("No results found.");
		});

		test("passes filters through", () => {
			const res = handleSearch(
				{ query: "Hello OR migration", source: "opencode" },
				db,
			);
			expect(res.content[0].text).toContain("[opencode]");
			expect(res.content[0].text).not.toContain("[claude-code]");
		});
	});

	describe("handleSessionList", () => {
		test("returns formatted session list", () => {
			const res = handleSessionList({}, db);
			expect(res.content[0].text).toContain("sess-1");
			expect(res.content[0].text).toContain("sess-2");
		});

		test("filters by source", () => {
			const res = handleSessionList({ source: "opencode" }, db);
			expect(res.content[0].text).toContain("[opencode]");
			expect(res.content[0].text).not.toContain("[claude-code]");
		});

		test("returns no sessions message", () => {
			const res = handleSessionList({ source: "openclaw" }, db);
			expect(res.content[0].text).toBe("No sessions found.");
		});
	});

	describe("handleSessionDetail", () => {
		test("returns session with messages", () => {
			const res = handleSessionDetail({ session_id: "sess-1" }, db);
			expect(res.content[0].text).toContain("[claude-code]");
			expect(res.content[0].text).toContain("[USER]");
			expect(res.content[0].text).toContain("[ASSISTANT]");
			expect(res.content[0].text).toContain("Hello world");
		});

		test("returns not found for missing session", () => {
			const res = handleSessionDetail({ session_id: "nope" }, db);
			expect(res.content[0].text).toContain("not found");
		});

		test("summary_only omits messages", () => {
			const res = handleSessionDetail(
				{ session_id: "sess-1", summary_only: true },
				db,
			);
			expect(res.content[0].text).toContain("[claude-code]");
			expect(res.content[0].text).not.toContain("[USER]");
		});

		test("filters by roles", () => {
			const res = handleSessionDetail(
				{ session_id: "sess-1", roles: ["user"] },
				db,
			);
			expect(res.content[0].text).toContain("[USER]");
			expect(res.content[0].text).not.toContain("[ASSISTANT]");
		});
	});

	describe("handleSync", () => {
		test("returns sync summary", async () => {
			const adapter: SourceAdapter = {
				source: "claude-code",
				async discover() {
					return [];
				},
				shouldSkip() {
					return false;
				},
				async parse() {
					return [];
				},
				buildCursor(fp) {
					return { ...fp, offset: 0, updatedAt: new Date().toISOString() };
				},
			};
			const cursorState: CursorState = { files: {}, updatedAt: "" };

			const res = await handleSync({}, db, [adapter], cursorState);
			expect(res.content[0].text).toContain("Sync complete");
			expect(res.content[0].text).toContain("0 parsed");
		});
	});

	describe("handleRelated", () => {
		test("returns related sessions", () => {
			const res = handleRelated({ context: "Hello" }, db);
			expect(res.content[0].text).toContain("sess-1");
		});

		test("returns no results message", () => {
			const res = handleRelated({ context: "nonexistent_xyz" }, db);
			expect(res.content[0].text).toBe("No related sessions found.");
		});

		test("filters by project", () => {
			const res = handleRelated(
				{ context: "Hello OR migration", project: "other-project" },
				db,
			);
			expect(res.content[0].text).toContain("[opencode]");
			expect(res.content[0].text).not.toContain("[claude-code]");
		});
	});

	describe("handleProjectSummary", () => {
		test("returns summary with sessions", () => {
			const res = handleProjectSummary({ days: 3650 }, db);
			expect(res.content[0].text).toContain("Sessions (last 3650 days): 2");
			expect(res.content[0].text).toContain("claude-code=1");
			expect(res.content[0].text).toContain("opencode=1");
		});

		test("filters by project", () => {
			const res = handleProjectSummary(
				{ project: "other-project", days: 3650 },
				db,
			);
			expect(res.content[0].text).toContain("Sessions (last 3650 days): 1");
		});

		test("returns zero when no matches", () => {
			const res = handleProjectSummary({ project: "no-such-project" }, db);
			expect(res.content[0].text).toContain("Sessions (last 7 days): 0");
		});
	});
});
