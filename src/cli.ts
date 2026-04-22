#!/usr/bin/env bun
import { VERSION } from "./constants";
import { openDatabase } from "./core/db";
import { runMigrations } from "./core/migrate";
import { loadCursors, saveCursors } from "./core/cursor";
import { claudeCodeAdapter } from "./adapters/claude-code/adapter";
import { createServer } from "./server/mcp";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { runSync } from "./core/sync";

const USAGE = `synapse v${VERSION}

Usage:
  synapse serve --stdio   Start MCP server over stdio
  synapse sync [--source <name>]  Run sync and exit
  synapse --version       Print version
  synapse --help          Show this help`;

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
		if (!args.includes("--stdio")) {
			console.error("Error: 'serve' requires --stdio flag");
			process.exit(1);
		}
		const db = openDatabase();
		runMigrations(db);
		const cursorState = await loadCursors();
		const adapters = [claudeCodeAdapter];
		const server = createServer(db, adapters, cursorState);
		const transport = new StdioServerTransport();
		await server.connect(transport);
		return;
	}

	if (command === "sync") {
		const sourceIdx = args.indexOf("--source");
		const source = sourceIdx !== -1 ? args[sourceIdx + 1] : undefined;

		const db = openDatabase();
		runMigrations(db);
		const cursorState = await loadCursors();
		const adapters = [claudeCodeAdapter];

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

	console.error(`Unknown command: ${command}\n`);
	console.log(USAGE);
	process.exit(1);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
