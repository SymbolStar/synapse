import http from "node:http";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Database } from "bun:sqlite";
import { handleApiRequest } from "../../web/api";
import {
	renderDashboard,
	renderSearchPage,
	renderSessionDetailPage,
	renderSessionsPage,
} from "../../web/pages";
import { getStats, listSessions, getSessionDetail, search } from "../../core/search";

const DEFAULT_PORT = 7099;

export async function startSSEServer(
	server: McpServer,
	port = DEFAULT_PORT,
	db?: Database,
): Promise<http.Server> {
	const sessions = new Map<string, SSEServerTransport>();

	const httpServer = http.createServer(async (req, res) => {
		const url = new URL(req.url ?? "/", `http://localhost:${port}`);

		// Health check
		if (req.method === "GET" && url.pathname === "/health") {
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ status: "ok" }));
			return;
		}

		// SSE endpoint — new client connection
		if (req.method === "GET" && url.pathname === "/sse") {
			const transport = new SSEServerTransport("/messages", res);
			sessions.set(transport.sessionId, transport);
			transport.onclose = () => sessions.delete(transport.sessionId);
			await server.connect(transport);
			return;
		}

		// Message endpoint — client POSTs JSON-RPC messages
		if (req.method === "POST" && url.pathname === "/messages") {
			const sessionId = url.searchParams.get("sessionId");
			const transport = sessionId ? sessions.get(sessionId) : undefined;
			if (!transport) {
				res.writeHead(400).end("Unknown session");
				return;
			}
			await transport.handlePostMessage(req, res);
			return;
		}

		// Web dashboard and API (require db)
		if (db) {
			// REST API
			if (handleApiRequest(db, req, res, url)) return;

			// Web pages
			if (req.method === "GET") {
				if (url.pathname === "/") {
					const stats = getStats(db);
					const recent = listSessions(db, { limit: 10 });
					res.writeHead(200, { "Content-Type": "text/html" });
					res.end(renderDashboard(stats, recent));
					return;
				}
				if (url.pathname === "/search") {
					const q = url.searchParams.get("q") ?? undefined;
					const source = url.searchParams.get("source") ?? undefined;
					const srcFilter = source && source !== "all" ? source : undefined;
					let results: import("../../types").SearchResult[] | undefined;
					if (q) {
						results = search(db, {
							query: q,
							source: srcFilter as any,
							limit: 50,
						});
					}
					res.writeHead(200, { "Content-Type": "text/html" });
					res.end(renderSearchPage(results, q, source));
					return;
				}
				if (url.pathname === "/sessions") {
					const source = url.searchParams.get("source") ?? undefined;
					const project = url.searchParams.get("project") ?? undefined;
					const srcFilter = source && source !== "all" ? source : undefined;
					const sessions = listSessions(db, {
						source: srcFilter as any,
						project: project || undefined,
						limit: 50,
					});
					res.writeHead(200, { "Content-Type": "text/html" });
					res.end(renderSessionsPage(sessions, source, project));
					return;
				}
				if (url.pathname.startsWith("/session/")) {
					const id = url.pathname.slice("/session/".length);
					const detail = getSessionDetail(db, id);
					if (!detail) {
						res.writeHead(404).end("Session not found");
						return;
					}
					res.writeHead(200, { "Content-Type": "text/html" });
					res.end(renderSessionDetailPage(detail));
					return;
				}
			}
		}

		res.writeHead(404).end("Not found");
	});

	return new Promise((resolve) => {
		httpServer.listen(port, () => {
			console.error(
				`Synapse MCP server listening on http://localhost:${port}`,
			);
			resolve(httpServer);
		});
	});
}
