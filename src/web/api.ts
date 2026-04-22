import type { Database } from "bun:sqlite";
import type http from "node:http";
import {
	getStats,
	listSessions,
	getSessionDetail,
	search,
	getProjectSummary,
} from "../core/search";

function jsonResponse(res: http.ServerResponse, data: unknown, status = 200) {
	res.writeHead(status, { "Content-Type": "application/json" });
	res.end(JSON.stringify(data));
}

export function handleApiRequest(
	db: Database,
	req: http.IncomingMessage,
	res: http.ServerResponse,
	url: URL,
): boolean {
	if (!url.pathname.startsWith("/api/")) return false;

	if (req.method !== "GET") {
		jsonResponse(res, { error: "Method not allowed" }, 405);
		return true;
	}

	// GET /api/stats
	if (url.pathname === "/api/stats") {
		jsonResponse(res, getStats(db));
		return true;
	}

	// GET /api/sessions/:id
	const sessionMatch = url.pathname.match(/^\/api\/sessions\/(.+)$/);
	if (sessionMatch) {
		const detail = getSessionDetail(db, sessionMatch[1]);
		if (!detail) {
			jsonResponse(res, { error: "Session not found" }, 404);
		} else {
			jsonResponse(res, detail);
		}
		return true;
	}

	// GET /api/sessions
	if (url.pathname === "/api/sessions") {
		const source = url.searchParams.get("source") ?? undefined;
		const project = url.searchParams.get("project") ?? undefined;
		const limit = url.searchParams.get("limit");
		jsonResponse(
			res,
			listSessions(db, {
				source: source as any,
				project,
				limit: limit ? Number(limit) : undefined,
			}),
		);
		return true;
	}

	// GET /api/search?q=...
	if (url.pathname === "/api/search") {
		const q = url.searchParams.get("q");
		if (!q) {
			jsonResponse(res, { error: "Missing query parameter 'q'" }, 400);
			return true;
		}
		const source = url.searchParams.get("source") ?? undefined;
		const limit = url.searchParams.get("limit");
		jsonResponse(
			res,
			search(db, {
				query: q,
				source: source as any,
				limit: limit ? Number(limit) : undefined,
			}),
		);
		return true;
	}

	// GET /api/projects
	if (url.pathname === "/api/projects") {
		const days = url.searchParams.get("days");
		const project = url.searchParams.get("project") ?? undefined;
		jsonResponse(
			res,
			getProjectSummary(db, {
				project,
				days: days ? Number(days) : undefined,
			}),
		);
		return true;
	}

	jsonResponse(res, { error: "Not found" }, 404);
	return true;
}
