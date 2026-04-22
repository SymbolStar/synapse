import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../../src/core/migrate";
import { createServer } from "../../src/server/mcp";
import { startSSEServer } from "../../src/server/transport/sse";
import { indexParseResults } from "../../src/core/indexer";
import type { SourceAdapter } from "../../src/adapters/types";
import type { CursorState, ParseResult } from "../../src/types";
import type http from "node:http";

function makeAdapter(): SourceAdapter {
	return {
		source: "claude-code",
		async discover() { return []; },
		shouldSkip() { return false; },
		async parse() { return []; },
		buildCursor(fp) { return { ...fp, offset: 0, updatedAt: new Date().toISOString() }; },
	};
}

function seedData(db: Database) {
	const now = new Date().toISOString();
	const results: ParseResult[] = [
		{
			canonical: {
				sessionKey: "test-session-1",
				source: "claude-code",
				projectRef: "/tmp/proj",
				projectName: "my-project",
				startedAt: now,
				lastMessageAt: now,
				durationSeconds: 60,
				messages: [
					{ role: "user", content: "Hello world", timestamp: now },
					{ role: "assistant", content: "Hi there!", timestamp: now },
				],
				totalInputTokens: 10,
				totalOutputTokens: 20,
				totalCachedTokens: 0,
			},
		},
	];
	indexParseResults(db, results);
}

describe("Web API", () => {
	let db: Database;
	let httpServer: http.Server;
	const port = 17199;

	beforeEach(() => {
		db = new Database(":memory:");
		db.exec("PRAGMA journal_mode = WAL");
		db.exec("PRAGMA foreign_keys = ON");
		runMigrations(db);
		seedData(db);
	});

	afterEach(async () => {
		if (httpServer) {
			await new Promise<void>((r) => httpServer.close(() => r()));
		}
		if (db) db.close();
	});

	async function startServer() {
		const cursorState: CursorState = { files: {}, updatedAt: "" };
		const server = createServer(db, [makeAdapter()], cursorState);
		httpServer = await startSSEServer(server, port, db);
	}

	test("GET /api/stats returns valid JSON", async () => {
		await startServer();
		const res = await fetch(`http://localhost:${port}/api/stats`);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.totalSessions).toBe(1);
		expect(data.totalMessages).toBe(2);
		expect(data.bySource["claude-code"]).toBe(1);
		expect(typeof data.dbSizeBytes).toBe("number");
	});

	test("GET /api/sessions returns session list", async () => {
		await startServer();
		const res = await fetch(`http://localhost:${port}/api/sessions`);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(Array.isArray(data)).toBe(true);
		expect(data.length).toBe(1);
		expect(data[0].source).toBe("claude-code");
	});

	test("GET /api/sessions with source filter", async () => {
		await startServer();
		const res = await fetch(`http://localhost:${port}/api/sessions?source=opencode`);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.length).toBe(0);
	});

	test("GET /api/sessions/:id returns session detail", async () => {
		await startServer();
		const listRes = await fetch(`http://localhost:${port}/api/sessions`);
		const sessions = await listRes.json();
		const id = sessions[0].id;

		const res = await fetch(`http://localhost:${port}/api/sessions/${id}`);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.id).toBe(id);
		expect(Array.isArray(data.messages)).toBe(true);
		expect(data.messages.length).toBe(2);
	});

	test("GET /api/sessions/:id returns 404 for unknown", async () => {
		await startServer();
		const res = await fetch(`http://localhost:${port}/api/sessions/nonexistent`);
		expect(res.status).toBe(404);
	});

	test("GET /api/search requires q parameter", async () => {
		await startServer();
		const res = await fetch(`http://localhost:${port}/api/search`);
		expect(res.status).toBe(400);
	});

	test("GET /api/search returns results", async () => {
		await startServer();
		const res = await fetch(`http://localhost:${port}/api/search?q=hello`);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(Array.isArray(data)).toBe(true);
		expect(data.length).toBeGreaterThan(0);
	});

	test("GET /api/projects returns summary", async () => {
		await startServer();
		const res = await fetch(`http://localhost:${port}/api/projects`);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(typeof data.totalSessions).toBe("number");
		expect(typeof data.bySource).toBe("object");
	});

	test("GET / returns dashboard HTML", async () => {
		await startServer();
		const res = await fetch(`http://localhost:${port}/`);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("text/html");
		const html = await res.text();
		expect(html).toContain("Synapse");
		expect(html).toContain("Dashboard");
	});

	test("GET /search returns placeholder page", async () => {
		await startServer();
		const res = await fetch(`http://localhost:${port}/search`);
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).toContain("Search");
	});
});
