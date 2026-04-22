import type { DbStats, SessionSummary } from "../core/search";

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
<td class="py-2 px-3"><span class="px-2 py-0.5 bg-gray-700 rounded text-xs">${escapeHtml(s.source)}</span></td>
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

export function renderPlaceholder(title: string): string {
	return renderLayout(
		title,
		`<h1 class="text-2xl font-bold text-white mb-4">${escapeHtml(title)}</h1>
<p class="text-gray-400">Coming soon.</p>`,
	);
}
