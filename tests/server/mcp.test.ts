import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../../src/core/migrate";
import { createServer } from "../../src/server/mcp";
import type { SourceAdapter } from "../../src/adapters/types";
import type { CursorState } from "../../src/types";

function makeAdapter(): SourceAdapter {
	return {
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
}

describe("createServer", () => {
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

	test("returns an McpServer instance", () => {
		const cursorState: CursorState = { files: {}, updatedAt: "" };
		const server = createServer(db, [makeAdapter()], cursorState);
		expect(server).toBeDefined();
		expect(server.server).toBeDefined();
	});

	test("has all 4 tools registered", () => {
		const cursorState: CursorState = { files: {}, updatedAt: "" };
		const server = createServer(db, [makeAdapter()], cursorState);
		// The underlying Server exposes registered tools via internal state
		// We verify by checking the McpServer has a server property
		const s = server as any;
		const tools = s._registeredTools;
		expect(tools).toBeDefined();
		const names = Object.keys(tools);
		expect(names).toContain("synapse_search");
		expect(names).toContain("synapse_session_list");
		expect(names).toContain("synapse_session_detail");
		expect(names).toContain("synapse_sync");
		expect(names).toHaveLength(4);
	});
});
