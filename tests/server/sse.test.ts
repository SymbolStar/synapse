import { describe, test, expect, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../../src/core/migrate";
import { createServer } from "../../src/server/mcp";
import { startSSEServer } from "../../src/server/transport/sse";
import type { SourceAdapter } from "../../src/adapters/types";
import type { CursorState } from "../../src/types";
import type http from "node:http";

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

describe("SSE transport", () => {
	let db: Database;
	let httpServer: http.Server;
	const port = 17099; // Use non-standard port for tests

	afterEach(async () => {
		if (httpServer) {
			await new Promise<void>((resolve) => httpServer.close(() => resolve()));
		}
		if (db) db.close();
	});

	test("starts and responds to /health", async () => {
		db = new Database(":memory:");
		db.exec("PRAGMA journal_mode = WAL");
		db.exec("PRAGMA foreign_keys = ON");
		runMigrations(db);

		const cursorState: CursorState = { files: {}, updatedAt: "" };
		const server = createServer(db, [makeAdapter()], cursorState);
		httpServer = await startSSEServer(server, port);

		const res = await fetch(`http://localhost:${port}/health`);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.status).toBe("ok");
	});

	test("/sse endpoint returns event stream", async () => {
		db = new Database(":memory:");
		db.exec("PRAGMA journal_mode = WAL");
		db.exec("PRAGMA foreign_keys = ON");
		runMigrations(db);

		const cursorState: CursorState = { files: {}, updatedAt: "" };
		const server = createServer(db, [makeAdapter()], cursorState);
		httpServer = await startSSEServer(server, port);

		const controller = new AbortController();
		const res = await fetch(`http://localhost:${port}/sse`, {
			signal: controller.signal,
		});
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("text/event-stream");
		controller.abort();
	});

	test("returns 404 for unknown paths", async () => {
		db = new Database(":memory:");
		db.exec("PRAGMA journal_mode = WAL");
		db.exec("PRAGMA foreign_keys = ON");
		runMigrations(db);

		const cursorState: CursorState = { files: {}, updatedAt: "" };
		const server = createServer(db, [makeAdapter()], cursorState);
		httpServer = await startSSEServer(server, port);

		const res = await fetch(`http://localhost:${port}/nonexistent`);
		expect(res.status).toBe(404);
	});
});
