import http from "node:http";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const DEFAULT_PORT = 7099;

export async function startSSEServer(
	server: McpServer,
	port = DEFAULT_PORT,
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
