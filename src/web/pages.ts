import type { DbStats, SessionSummary, SessionDetail } from "../core/search";
import type { SearchResult } from "../types";

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1048576).toFixed(1)} MB`;
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function sourceBadge(source: string): string {
	const colors: Record<string, string> = {
		"claude-code": "bg-yellow-600",
		opencode: "bg-blue-600",
		openclaw: "bg-green-600",
	};
	const bg = colors[source] ?? "bg-gray-600";
	return `<span class="px-2 py-0.5 rounded text-xs text-white ${bg}">${escapeHtml(source)}</span>`;
}

function renderLayout(title: string, content: string): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} - Synapse</title>
<link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
<style>body{background:#111827;color:#e5e7eb}</style>
</head>
<body class="min-h-screen">
<nav class="bg-gray-800 border-b border-gray-700">
<div class="max-w-6xl mx-auto px-4 py-3 flex items-center gap-6">
<span class="text-lg font-bold text-white">Synapse</span>
<a href="/" class="text-gray-300 hover:text-white">Home</a>
<a href="/search" class="text-gray-300 hover:text-white">Search</a>
<a href="/sessions" class="text-gray-300 hover:text-white">Sessions</a>
</div>
</nav>
<main class="max-w-6xl mx-auto px-4 py-8">${content}</main>
</body>
</html>`;
}

function renderStatCard(label: string, value: string): string {
	return `<div class="bg-gray-800 rounded-lg p-5 border border-gray-700">
<div class="text-sm text-gray-400">${escapeHtml(label)}</div>
<div class="text-2xl font-bold text-white mt-1">${escapeHtml(value)}</div>
</div>`;
}

function renderSessionRow(s: SessionSummary): string {
	const date = s.startedAt ? new Date(s.startedAt).toLocaleString() : "—";
	const title = s.title || s.projectName || "Untitled";
	return `<tr class="border-b border-gray-700 hover:bg-gray-800">
<td class="py-2 px-3"><a href="/session/${escapeHtml(s.id)}" class="text-blue-400 hover:underline">${escapeHtml(title)}</a></td>
<td class="py-2 px-3">${sourceBadge(s.source)}</td>
<td class="py-2 px-3 text-gray-400">${escapeHtml(date)}</td>
<td class="py-2 px-3 text-right text-gray-400">${s.messageCount}</td>
</tr>`;
}

export function renderDashboard(
	stats: DbStats,
	recentSessions: SessionSummary[],
): string {
	const sourceList = Object.entries(stats.bySource)
		.map(([k, v]) => `${k}: ${v}`)
		.join(", ") || "none";

	const cards = `<div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
${renderStatCard("Total Sessions", String(stats.totalSessions))}
${renderStatCard("Messages", String(stats.totalMessages))}
${renderStatCard("Sources", sourceList)}
${renderStatCard("DB Size", formatBytes(stats.dbSizeBytes))}
</div>`;

	let table: string;
	if (recentSessions.length === 0) {
		table = '<p class="text-gray-500">No sessions yet. Run a sync to get started.</p>';
	} else {
		table = `<table class="w-full text-sm">
<thead><tr class="text-left text-gray-400 border-b border-gray-600">
<th class="py-2 px-3">Session</th><th class="py-2 px-3">Source</th>
<th class="py-2 px-3">Date</th><th class="py-2 px-3 text-right">Messages</th>
</tr></thead>
<tbody>${recentSessions.map(renderSessionRow).join("")}</tbody>
</table>`;
	}

	return renderLayout(
		"Dashboard",
		`<h1 class="text-2xl font-bold text-white mb-6">Dashboard</h1>${cards}
<h2 class="text-lg font-semibold text-white mb-4">Recent Sessions</h2>${table}`,
	);
}

const SOURCE_OPTIONS = ["all", "claude-code", "opencode", "openclaw"];

export function renderSearchPage(
	results?: SearchResult[],
	query?: string,
	source?: string,
): string {
	const sourceOpts = SOURCE_OPTIONS.map(
		(s) =>
			`<option value="${s}"${source === s ? " selected" : ""}>${escapeHtml(s)}</option>`,
	).join("");

	const form = `<form method="GET" action="/search" class="flex gap-3 mb-6">
<input type="text" name="q" value="${escapeHtml(query ?? "")}" placeholder="Search messages..." class="flex-1 px-3 py-2 bg-gray-800 border border-gray-600 rounded text-white">
<select name="source" class="px-3 py-2 bg-gray-800 border border-gray-600 rounded text-white">${sourceOpts}</select>
<button type="submit" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">Search</button>
</form>`;

	let body: string;
	if (results === undefined) {
		body = "";
	} else if (results.length === 0) {
		body = '<p class="text-gray-400">No results found.</p>';
	} else {
		const rows = results
			.map((r) => {
				const title = r.title || r.projectName || "Untitled";
				const snippet = r.snippet
					.replace(/>>>/g, '<mark class="bg-yellow-700 text-white">')
					.replace(/<<</g, "</mark>");
				const ts = r.timestamp ? new Date(r.timestamp).toLocaleString() : "";
				return `<div class="bg-gray-800 border border-gray-700 rounded p-4 mb-3">
<div class="flex items-center gap-2 mb-1">${sourceBadge(r.source)}
<a href="/session/${escapeHtml(r.sessionKey)}" class="text-blue-400 hover:underline font-medium">${escapeHtml(title)}</a>
<span class="text-gray-500 text-xs ml-auto">${escapeHtml(ts)}</span></div>
<p class="text-sm text-gray-300" style="white-space:pre-wrap">${snippet}</p>
</div>`;
			})
			.join("");
		body = `<p class="text-gray-400 mb-3">${results.length} result${results.length === 1 ? "" : "s"} found</p>${rows}`;
	}

	return renderLayout(
		"Search",
		`<h1 class="text-2xl font-bold text-white mb-6">Search</h1>${form}${body}`,
	);
}

export function renderSessionDetailPage(detail: SessionDetail): string {
	const title = detail.title || detail.projectName || "Untitled";
	const started = detail.startedAt ? new Date(detail.startedAt).toLocaleString() : "—";
	const ended = detail.endedAt ? new Date(detail.endedAt).toLocaleString() : "—";
	const dur = detail.durationSeconds
		? `${Math.round(detail.durationSeconds / 60)} min`
		: "—";
	const tokens = detail.totalInputTokens + detail.totalOutputTokens;

	const header = `<div class="bg-gray-800 border border-gray-700 rounded-lg p-5 mb-6">
<div class="flex items-center gap-3 mb-3">
<h1 class="text-xl font-bold text-white">${escapeHtml(title)}</h1>
${sourceBadge(detail.source)}
</div>
<div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
<div><span class="text-gray-400">Project:</span> <span class="text-white">${escapeHtml(detail.projectName ?? "—")}</span></div>
<div><span class="text-gray-400">Started:</span> <span class="text-white">${escapeHtml(started)}</span></div>
<div><span class="text-gray-400">Ended:</span> <span class="text-white">${escapeHtml(ended)}</span></div>
<div><span class="text-gray-400">Duration:</span> <span class="text-white">${escapeHtml(dur)}</span></div>
<div><span class="text-gray-400">Messages:</span> <span class="text-white">${detail.messageCount}</span></div>
<div><span class="text-gray-400">Tokens:</span> <span class="text-white">${tokens.toLocaleString()}</span></div>
</div>
</div>`;

	const msgs = detail.messages
		.map((m) => {
			const isUser = m.role === "user";
			const isTool = m.role === "tool";
			const align = isUser ? "ml-auto" : "mr-auto";
			const bg = isUser ? "bg-blue-900" : isTool ? "bg-yellow-900" : "bg-gray-700";
			const maxW = "max-w-3xl";
			const toolTag = isTool && m.toolName
				? `<span class="px-2 py-0.5 bg-yellow-700 rounded text-xs text-white mb-1 inline-block">${escapeHtml(m.toolName)}</span><br>`
				: "";
			const ts = m.timestamp ? `<div class="text-xs text-gray-500 mt-1">${escapeHtml(new Date(m.timestamp).toLocaleString())}</div>` : "";
			return `<div class="${align} ${maxW} ${bg} rounded-lg p-3 mb-2">
${toolTag}<div class="text-sm text-gray-200" style="white-space:pre-wrap">${escapeHtml(m.content)}</div>${ts}
</div>`;
		})
		.join("");

	const scrollBtn = `<a href="#" onclick="window.scrollTo(0,0);return false" class="fixed bottom-6 right-6 bg-gray-700 text-white rounded-full w-10 h-10 flex items-center justify-center hover:bg-gray-600">&uarr;</a>`;

	return renderLayout(
		title,
		`${header}<div class="space-y-1">${msgs}</div>${scrollBtn}`,
	);
}

export function renderSessionsPage(
	sessions: SessionSummary[],
	source?: string,
	project?: string,
): string {
	const sourceOpts = SOURCE_OPTIONS.map(
		(s) =>
			`<option value="${s}"${source === s ? " selected" : ""}>${escapeHtml(s)}</option>`,
	).join("");

	const filterBar = `<form method="GET" action="/sessions" class="flex gap-3 mb-6">
<select name="source" class="px-3 py-2 bg-gray-800 border border-gray-600 rounded text-white">${sourceOpts}</select>
<input type="text" name="project" value="${escapeHtml(project ?? "")}" placeholder="Filter by project..." class="px-3 py-2 bg-gray-800 border border-gray-600 rounded text-white">
<button type="submit" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">Filter</button>
</form>`;

	let table: string;
	if (sessions.length === 0) {
		table = '<p class="text-gray-400">No sessions found.</p>';
	} else {
		const rows = sessions
			.map((s) => {
				const title = s.title || s.projectName || "Untitled";
				const date = s.startedAt ? new Date(s.startedAt).toLocaleString() : "—";
				const tokens = s.totalInputTokens + s.totalOutputTokens;
				return `<tr class="border-b border-gray-700 hover:bg-gray-800">
<td class="py-2 px-3"><a href="/session/${escapeHtml(s.id)}" class="text-blue-400 hover:underline">${escapeHtml(title)}</a></td>
<td class="py-2 px-3">${sourceBadge(s.source)}</td>
<td class="py-2 px-3 text-gray-400">${escapeHtml(s.projectName ?? "—")}</td>
<td class="py-2 px-3 text-right text-gray-400">${s.messageCount}</td>
<td class="py-2 px-3 text-right text-gray-400">${tokens.toLocaleString()}</td>
<td class="py-2 px-3 text-gray-400">${escapeHtml(date)}</td>
</tr>`;
			})
			.join("");
		table = `<table class="w-full text-sm">
<thead><tr class="text-left text-gray-400 border-b border-gray-600">
<th class="py-2 px-3">Session</th><th class="py-2 px-3">Source</th>
<th class="py-2 px-3">Project</th><th class="py-2 px-3 text-right">Messages</th>
<th class="py-2 px-3 text-right">Tokens</th><th class="py-2 px-3">Date</th>
</tr></thead>
<tbody>${rows}</tbody>
</table>`;
	}

	return renderLayout(
		"Sessions",
		`<h1 class="text-2xl font-bold text-white mb-6">Sessions</h1>${filterBar}${table}`,
	);
}
