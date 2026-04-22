#!/usr/bin/env bun
import { VERSION } from "./constants";
import { openDatabase } from "./core/db";
import { runMigrations } from "./core/migrate";
import { loadCursors, saveCursors } from "./core/cursor";
import { claudeCodeAdapter } from "./adapters/claude-code/adapter";
import { openCodeAdapter } from "./adapters/opencode/adapter";
import { openClawAdapter } from "./adapters/openclaw/adapter";
import { createServer } from "./server/mcp";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { startSSEServer } from "./server/transport/sse";
import { runSync } from "./core/sync";
import {
	search,
	listSessions,
	getSessionDetail,
	getStats,
} from "./core/search";

function getFlag(args: string[], flag: string): string | undefined {
	const idx = args.indexOf(flag);
	return idx !== -1 ? args[idx + 1] : undefined;
}

const USAGE = `synapse v${VERSION}

Usage:
  synapse serve --stdio              Start MCP server over stdio
  synapse serve --sse [--port 7099]  Start MCP server over SSE (HTTP)
  synapse sync [--source <name>]     Run sync and exit
  synapse search <query> [--source X] [--project X] [--limit N]
  synapse sessions [--source X] [--project X] [--limit N]
  synapse show <session_id>          Show session detail
  synapse stats                      Show database statistics
  synapse --version                  Print version
  synapse --help                     Show this help`;

async function main() {
	const args = process.argv.slice(2);
	const command = args[0];

	if (!command || command === "--help" || command === "-h") {
		console.log(USAGE);
		process.exit(0);
	}

	if (command === "--version" || command === "-v") {
		console.log(VERSION);
		process.exit(0);
	}

	if (command === "serve") {
		const useSSE = args.includes("--sse");
		const useStdio = args.includes("--stdio");

		if (!useSSE && !useStdio) {
			console.error("Error: 'serve' requires --stdio or --sse flag");
			process.exit(1);
		}

		const db = openDatabase();
		runMigrations(db);
		const cursorState = await loadCursors();
		const adapters = [claudeCodeAdapter, openCodeAdapter, openClawAdapter];
		const server = createServer(db, adapters, cursorState);

		if (useSSE) {
			const portIdx = args.indexOf("--port");
			const port = portIdx !== -1 ? Number(args[portIdx + 1]) : undefined;
			await startSSEServer(server, port);
		} else {
			const transport = new StdioServerTransport();
			await server.connect(transport);
		}
		return;
	}

	if (command === "sync") {
		const sourceIdx = args.indexOf("--source");
		const source = sourceIdx !== -1 ? args[sourceIdx + 1] : undefined;

		const db = openDatabase();
		runMigrations(db);
		const cursorState = await loadCursors();
		const adapters = [claudeCodeAdapter, openCodeAdapter, openClawAdapter];

		const result = await runSync(db, adapters, cursorState, { source });
		await saveCursors(cursorState);

		console.log(
			`Sync complete: ${result.totalParsed} parsed, ${result.totalSkipped} skipped, ${result.totalFiles} files`,
		);
		if (result.errors.length > 0) {
			console.error(`Errors (${result.errors.length}):`);
			for (const e of result.errors) {
				console.error(`  - ${e}`);
			}
		}
		db.close();
		process.exit(result.errors.length > 0 ? 1 : 0);
	}

	if (command === "search") {
		const queryParts: string[] = [];
		for (let i = 1; i < args.length; i++) {
			if (args[i].startsWith("--")) { i++; continue; }
			queryParts.push(args[i]);
		}
		const query = queryParts.join(" ");
		if (!query) {
			console.error("Error: search requires a query");
			process.exit(1);
		}
		const db = openDatabase();
		runMigrations(db);
		const results = search(db, {
			query,
			source: getFlag(args, "--source") as any,
			project: getFlag(args, "--project"),
			limit: getFlag(args, "--limit") ? Number(getFlag(args, "--limit")) : undefined,
		});
		for (const r of results) {
			console.log(`[${r.source}] ${r.title ?? "(untitled)"} — ${r.sessionKey}`);
			console.log(`  ${r.snippet}`);
			console.log();
		}
		if (results.length === 0) console.log("No results found.");
		db.close();
		process.exit(0);
	}

	if (command === "sessions") {
		const db = openDatabase();
		runMigrations(db);
		const sessions = listSessions(db, {
			source: getFlag(args, "--source") as any,
			project: getFlag(args, "--project"),
			limit: getFlag(args, "--limit") ? Number(getFlag(args, "--limit")) : undefined,
		});
		for (const s of sessions) {
			const project = s.projectName ?? "(no project)";
			console.log(`${s.id}  [${s.source}]  ${project}  ${s.title ?? "(untitled)"}  ${s.startedAt}`);
		}
		if (sessions.length === 0) console.log("No sessions found.");
		db.close();
		process.exit(0);
	}

	if (command === "show") {
		const sessionId = args[1];
		if (!sessionId) {
			console.error("Error: show requires a session_id");
			process.exit(1);
		}
		const db = openDatabase();
		runMigrations(db);
		const detail = getSessionDetail(db, sessionId);
		if (!detail) {
			console.error(`Session not found: ${sessionId}`);
			db.close();
			process.exit(1);
		}
		console.log(`Session: ${detail.id} [${detail.source}]`);
		console.log(`Project: ${detail.projectName ?? "(none)"}`);
		console.log(`Title: ${detail.title ?? "(untitled)"}`);
		console.log(`Started: ${detail.startedAt}`);
		console.log(`Messages: ${detail.messageCount}\n`);
		for (const m of detail.messages) {
			const prefix = m.role === "user" ? "USER" : "ASST";
			const content = m.content.length > 500 ? m.content.slice(0, 500) + "..." : m.content;
			console.log(`[${prefix}] ${content}\n`);
		}
		db.close();
		process.exit(0);
	}

	if (command === "stats") {
		const db = openDatabase();
		runMigrations(db);
		const stats = getStats(db);
		console.log(`Sessions: ${stats.totalSessions}`);
		console.log(`Messages: ${stats.totalMessages}`);
		console.log(`DB size: ${(stats.dbSizeBytes / 1024 / 1024).toFixed(2)} MB`);
		console.log(`By source:`);
		for (const [src, count] of Object.entries(stats.bySource)) {
			console.log(`  ${src}: ${count}`);
		}
		db.close();
		process.exit(0);
	}

	console.error(`Unknown command: ${command}\n`);
	console.log(USAGE);
	process.exit(1);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
