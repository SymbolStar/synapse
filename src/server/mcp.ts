import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Database } from "bun:sqlite";
import type { SourceAdapter } from "../adapters/types";
import type { CursorState } from "../types";
import { VERSION } from "../constants";
import { handleSearch } from "./tools/search";
import { handleSessionList } from "./tools/session-list";
import { handleSessionDetail } from "./tools/session-detail";
import { handleSync } from "./tools/sync";

export function createServer(
	db: Database,
	adapters: SourceAdapter[],
	cursorState: CursorState,
): McpServer {
	const server = new McpServer({
		name: "synapse",
		version: VERSION,
	});

	server.tool(
		"synapse_search",
		"Full-text search across all indexed AI coding sessions",
		{
			query: z.string().describe("Search query (FTS5 syntax)"),
			source: z.enum(["claude-code", "opencode", "openclaw"]).optional().describe("Filter by source"),
			project: z.string().optional().describe("Filter by project name"),
			since: z.string().optional().describe("ISO date — only sessions after this date"),
			limit: z.number().optional().describe("Max results (default 10)"),
		},
		(args) => handleSearch(args, db),
	);

	server.tool(
		"synapse_session_list",
		"List indexed sessions with optional filters",
		{
			source: z.enum(["claude-code", "opencode", "openclaw"]).optional().describe("Filter by source"),
			project: z.string().optional().describe("Filter by project name"),
			since: z.string().optional().describe("ISO date — only sessions after this date"),
			limit: z.number().optional().describe("Max results"),
		},
		(args) => handleSessionList(args, db),
	);

	server.tool(
		"synapse_session_detail",
		"Get full detail of a session including messages",
		{
			session_id: z.string().describe("Session key"),
			roles: z.array(z.string()).optional().describe("Filter messages by role"),
			summary_only: z.boolean().optional().describe("Only return session header"),
		},
		(args) => handleSessionDetail(args, db),
	);

	server.tool(
		"synapse_sync",
		"Trigger a sync — discover and index new sessions from configured sources",
		{
			source: z.string().optional().describe("Only sync this source"),
		},
		async (args) => handleSync(args, db, adapters, cursorState),
	);

	return server;
}
