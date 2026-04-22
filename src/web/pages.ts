import type { DbStats, SessionSummary, SessionDetail } from "../core/search";
import type { SearchResult } from "../types";
import { getParticleScript } from "./particles";

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

const SOURCE_COLORS: Record<string, string> = {
	"claude-code": "#D97757",
	opencode: "#0071e3",
	openclaw: "#30D158",
};

function sourceBadge(source: string): string {
	const color = SOURCE_COLORS[source] ?? "#86868b";
	return `<span style="display:inline-block;padding:2px 10px;border-radius:980px;font-size:12px;font-weight:600;letter-spacing:-0.12px;line-height:1.33;color:#fff;background:${color}">${escapeHtml(source)}</span>`;
}

const CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700&display=swap');
:root{
--apple-blue:#0071e3;
--bright-blue:#2997ff;
--black:#000;
--white:#fff;
--gray-bg:#f5f5f7;
--near-black:#1d1d1f;
--dark-surface:#272729;
--text-secondary:rgba(255,255,255,0.56);
--font:'Inter',system-ui,-apple-system,BlinkMacSystemFont,'Helvetica Neue',sans-serif;
}
html{-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
body{
background:var(--black);color:var(--white);
font-family:var(--font);font-size:17px;font-weight:400;
line-height:1.47;letter-spacing:-0.374px;margin:0;
}
a{color:var(--bright-blue);text-decoration:none}
a:hover{text-decoration:underline}

/* Nav */
.nav{
position:sticky;top:0;z-index:100;height:48px;
background:rgba(0,0,0,0.8);
backdrop-filter:saturate(180%) blur(20px);-webkit-backdrop-filter:saturate(180%) blur(20px);
display:flex;align-items:center;justify-content:center;
}
.nav-inner{
width:100%;max-width:980px;padding:0 22px;
display:flex;align-items:center;justify-content:space-between;
}
.nav-brand{font-size:21px;font-weight:600;letter-spacing:0.231px;color:var(--white);text-decoration:none}
.nav-links{display:flex;gap:28px}
.nav-links a{font-size:12px;font-weight:400;color:rgba(255,255,255,0.8);letter-spacing:-0.12px;text-decoration:none}
.nav-links a:hover{color:var(--white)}
.nav-cta{
font-size:12px;padding:4px 14px;border-radius:980px;
background:var(--apple-blue);color:var(--white);text-decoration:none;font-weight:400;
}
.nav-cta:hover{text-decoration:none;opacity:0.88}

/* Layout */
.section{width:100%;padding:80px 22px}
.section-dark{background:var(--black);color:var(--white)}
.section-light{background:var(--gray-bg);color:var(--near-black)}
.container{max-width:980px;margin:0 auto}

/* Typography */
.display{font-size:56px;font-weight:600;line-height:1.07;letter-spacing:-0.28px}
.heading{font-size:40px;font-weight:600;line-height:1.10;letter-spacing:normal}
.tile-heading{font-size:28px;font-weight:400;line-height:1.14;letter-spacing:0.196px}
.body-text{font-size:17px;font-weight:400;line-height:1.47;letter-spacing:-0.374px}
.caption{font-size:14px;font-weight:400;line-height:1.29;letter-spacing:-0.224px}
.micro{font-size:12px;font-weight:400;line-height:1.33;letter-spacing:-0.12px}

/* Cards */
.card{
background:var(--dark-surface);border-radius:8px;padding:28px;
transition:box-shadow 0.3s ease;
}
.card:hover{box-shadow:rgba(0,0,0,0.22) 3px 5px 30px 0px}
.card-light{background:var(--gray-bg);color:var(--near-black)}

/* Stats */
.stats-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
@media(max-width:640px){.stats-grid{grid-template-columns:repeat(2,1fr)}}
.stat-value{font-size:40px;font-weight:600;line-height:1.10;letter-spacing:normal;margin-bottom:4px}
.stat-label{font-size:14px;font-weight:400;color:var(--text-secondary);letter-spacing:-0.224px;line-height:1.29}

/* Buttons */
.btn-primary{
display:inline-block;padding:8px 22px;border-radius:980px;
background:var(--apple-blue);color:var(--white);border:none;
font-family:var(--font);font-size:17px;font-weight:400;cursor:pointer;
text-decoration:none;line-height:1.47;letter-spacing:-0.374px;
}
.btn-primary:hover{opacity:0.88;text-decoration:none}
.btn-outline{
display:inline-block;padding:8px 22px;border-radius:980px;
background:transparent;color:var(--bright-blue);
border:1px solid var(--bright-blue);
font-family:var(--font);font-size:17px;font-weight:400;cursor:pointer;
text-decoration:none;
}
.btn-outline:hover{text-decoration:none;background:rgba(41,151,255,0.08)}

/* Pill filters */
.pill-group{display:flex;gap:8px;flex-wrap:wrap}
.pill{
display:inline-block;padding:6px 18px;border-radius:980px;
font-size:14px;font-weight:400;letter-spacing:-0.224px;
background:var(--dark-surface);color:rgba(255,255,255,0.8);
border:none;cursor:pointer;text-decoration:none;
font-family:var(--font);line-height:1.29;
}
.pill:hover{background:#363638;text-decoration:none}
.pill.active{background:var(--apple-blue);color:var(--white)}

/* Search input */
.search-wrap{
max-width:680px;margin:0 auto 48px;position:relative;
}
.search-input{
width:100%;padding:14px 22px;border-radius:11px;border:none;
background:var(--dark-surface);color:var(--white);
font-family:var(--font);font-size:17px;font-weight:400;
letter-spacing:-0.374px;outline:none;
}
.search-input::placeholder{color:rgba(255,255,255,0.36)}
.search-input:focus{box-shadow:0 0 0 3px var(--apple-blue)}

/* Table */
.table-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse}
thead th{
font-size:12px;font-weight:600;letter-spacing:-0.12px;
color:var(--text-secondary);text-align:left;
padding:10px 16px;border-bottom:1px solid rgba(255,255,255,0.08);
text-transform:uppercase;
}
tbody td{
padding:14px 16px;font-size:14px;letter-spacing:-0.224px;
border-bottom:1px solid rgba(255,255,255,0.06);
vertical-align:middle;
}
tbody tr{transition:background 0.15s}
tbody tr:hover{background:rgba(255,255,255,0.03)}
td a{color:var(--bright-blue)}

/* Result cards */
.result-card{
background:var(--dark-surface);border-radius:8px;padding:20px 24px;
margin-bottom:12px;transition:box-shadow 0.3s ease;
}
.result-card:hover{box-shadow:rgba(0,0,0,0.22) 3px 5px 30px 0px}
.result-meta{display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap}
.result-snippet{
font-size:14px;line-height:1.43;letter-spacing:-0.224px;
color:rgba(255,255,255,0.72);white-space:pre-wrap;
}
.result-snippet mark{background:rgba(0,113,227,0.3);color:var(--white);border-radius:2px;padding:0 2px}

/* Chat bubbles */
.msg{max-width:760px;margin-bottom:8px;padding:12px 18px;border-radius:12px;font-size:15px;line-height:1.47;letter-spacing:-0.374px;white-space:pre-wrap;word-break:break-word}
.msg-user{background:var(--apple-blue);color:var(--white);margin-left:auto;border-bottom-right-radius:4px}
.msg-assistant{background:var(--dark-surface);color:rgba(255,255,255,0.92);margin-right:auto;border-bottom-left-radius:4px}
.msg-tool{background:#2a2520;color:rgba(255,255,255,0.84);margin-right:auto;border-left:3px solid #D97757;border-bottom-left-radius:4px}
.msg-role{font-size:11px;font-weight:600;letter-spacing:0.4px;text-transform:uppercase;margin-bottom:4px;opacity:0.5}
.msg-ts{font-size:11px;margin-top:6px;opacity:0.36}
.msg code,.msg pre{font-family:'SF Mono',SFMono-Regular,Menlo,Consolas,monospace;font-size:13px}

/* Hero */
.hero{text-align:center;padding:100px 22px 80px}
.hero .display{margin-bottom:10px}
.hero .subtitle{font-size:28px;font-weight:400;line-height:1.14;letter-spacing:0.196px;color:var(--text-secondary)}
.hero .cta-group{margin-top:28px;display:flex;gap:14px;justify-content:center}

/* Session header */
.session-header{padding:40px 0 32px}
.session-header .tile-heading{margin-bottom:12px}
.session-meta{display:flex;flex-wrap:wrap;gap:20px}
.session-meta-item .meta-label{font-size:12px;font-weight:600;letter-spacing:-0.12px;color:var(--text-secondary);text-transform:uppercase;margin-bottom:2px}
.session-meta-item .meta-value{font-size:17px;font-weight:400;letter-spacing:-0.374px}

/* Source dots */
.source-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:middle}

/* Scroll top */
.scroll-top{
position:fixed;bottom:28px;right:28px;width:44px;height:44px;
border-radius:50%;background:var(--dark-surface);color:var(--white);
display:flex;align-items:center;justify-content:center;
font-size:18px;text-decoration:none;
transition:background 0.2s;
}
.scroll-top:hover{background:#363638;text-decoration:none}

/* No results */
.empty{text-align:center;padding:60px 0;color:var(--text-secondary);font-size:17px}
`;

function renderLayout(title: string, content: string): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} - Synapse</title>
<style>${CSS}</style>
</head>
<body>
${getParticleScript()}
<div style="position:relative;z-index:1">
<nav class="nav">
<div class="nav-inner">
<a href="/" class="nav-brand">Synapse</a>
<div class="nav-links">
<a href="/">Dashboard</a>
<a href="/search">Search</a>
<a href="/sessions">Sessions</a>
</div>
<a href="/search" class="nav-cta">Search</a>
</div>
</nav>
${content}
</div>
</body>
</html>`;
}

export function renderDashboard(
	stats: DbStats,
	recentSessions: SessionSummary[],
): string {
	const sourceBreakdown = Object.entries(stats.bySource)
		.map(([k, v]) => {
			const color = SOURCE_COLORS[k] ?? "#86868b";
			return `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:16px"><span class="source-dot" style="background:${color}"></span><span class="caption">${escapeHtml(k)}</span><span style="font-weight:600;margin-left:2px">${v}</span></span>`;
		})
		.join("") || '<span class="caption" style="color:var(--text-secondary)">No sources yet</span>';

	const rows = recentSessions
		.map((s) => {
			const date = s.startedAt ? new Date(s.startedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "\u2014";
			const title = s.title || s.projectName || "Untitled";
			return `<tr>
<td><a href="/session/${escapeHtml(s.id)}">${escapeHtml(title)}</a></td>
<td>${sourceBadge(s.source)}</td>
<td style="color:var(--text-secondary)">${escapeHtml(date)}</td>
<td style="text-align:right;color:var(--text-secondary)">${s.messageCount}</td>
</tr>`;
		})
		.join("");

	const tableHtml = recentSessions.length === 0
		? '<p class="empty">No sessions yet. Run a sync to get started.</p>'
		: `<div class="table-wrap"><table>
<thead><tr><th>Session</th><th>Source</th><th>Date</th><th style="text-align:right">Messages</th></tr></thead>
<tbody>${rows}</tbody>
</table></div>`;

	return renderLayout("Dashboard", `
<div class="hero section-dark">
<h1 class="display">Synapse</h1>
<p class="subtitle">AI Session Memory</p>
<div class="cta-group">
<a href="/search" class="btn-primary">Search Sessions</a>
<a href="/sessions" class="btn-outline">Browse All</a>
</div>
</div>

<div class="section section-dark">
<div class="container">
<div class="stats-grid">
<div class="card">
<div class="stat-value">${stats.totalSessions.toLocaleString()}</div>
<div class="stat-label">Sessions</div>
</div>
<div class="card">
<div class="stat-value">${stats.totalMessages.toLocaleString()}</div>
<div class="stat-label">Messages</div>
</div>
<div class="card">
<div class="stat-value">${Object.keys(stats.bySource).length}</div>
<div class="stat-label">Sources</div>
</div>
<div class="card">
<div class="stat-value">${formatBytes(stats.dbSizeBytes)}</div>
<div class="stat-label">Database</div>
</div>
</div>
<div style="margin-top:20px">${sourceBreakdown}</div>
</div>
</div>

<div class="section section-dark" style="padding-top:0">
<div class="container">
<h2 class="heading" style="margin-bottom:32px">Recent Sessions</h2>
${tableHtml}
</div>
</div>
`);
}

const SOURCE_OPTIONS = ["all", "claude-code", "opencode", "openclaw"];

export function renderSearchPage(
	results?: SearchResult[],
	query?: string,
	source?: string,
): string {
	const pills = SOURCE_OPTIONS.map((s) => {
		const label = s === "all" ? "All" : s === "claude-code" ? "Claude Code" : s === "opencode" ? "OpenCode" : "OpenClaw";
		const active = (source ?? "all") === s ? " active" : "";
		return `<a href="/search?q=${encodeURIComponent(query ?? "")}&source=${s}" class="pill${active}">${label}</a>`;
	}).join("");

	let body: string;
	if (results === undefined) {
		body = '<p class="empty">Enter a query to search across all your AI sessions.</p>';
	} else if (results.length === 0) {
		body = '<p class="empty">No results found.</p>';
	} else {
		const cards = results
			.map((r) => {
				const title = r.title || r.projectName || "Untitled";
				const snippet = r.snippet
					.replace(/>>>/g, "<mark>")
					.replace(/<<</g, "</mark>");
				const ts = r.timestamp ? new Date(r.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
				return `<div class="result-card">
<div class="result-meta">
${sourceBadge(r.source)}
<a href="/session/${escapeHtml(r.sessionKey)}" style="font-size:17px;font-weight:600;letter-spacing:-0.374px">${escapeHtml(title)}</a>
<span class="caption" style="margin-left:auto;color:var(--text-secondary)">${escapeHtml(ts)}</span>
</div>
<div class="result-snippet">${snippet}</div>
</div>`;
			})
			.join("");
		body = `<p class="caption" style="color:var(--text-secondary);margin-bottom:16px">${results.length} result${results.length === 1 ? "" : "s"}</p>${cards}`;
	}

	return renderLayout("Search", `
<div class="section section-dark" style="padding-bottom:40px">
<div class="container" style="text-align:center">
<h1 class="heading" style="margin-bottom:32px">Search</h1>
<form method="GET" action="/search">
<div class="search-wrap">
<input type="text" name="q" value="${escapeHtml(query ?? "")}" placeholder="Search messages\u2026" class="search-input" autofocus>
<input type="hidden" name="source" value="${escapeHtml(source ?? "all")}" id="source-input">
</div>
<div class="pill-group" style="justify-content:center;margin-bottom:24px">
${pills}
</div>
<button type="submit" class="btn-primary" style="margin-top:8px">Search</button>
</form>
</div>
</div>

<div class="section section-dark" style="padding-top:0">
<div class="container">
${body}
</div>
</div>

<script>
document.querySelectorAll('.pill').forEach(function(p){
p.addEventListener('click',function(e){
e.preventDefault();
document.getElementById('source-input').value=new URL(this.href).searchParams.get('source')||'all';
document.querySelectorAll('.pill').forEach(function(x){x.classList.remove('active')});
this.classList.add('active');
this.closest('form').submit();
});
});
</script>
`);
}

export function renderSessionDetailPage(detail: SessionDetail): string {
	const title = detail.title || detail.projectName || "Untitled";
	const started = detail.startedAt ? new Date(detail.startedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "\u2014";
	const ended = detail.endedAt ? new Date(detail.endedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "\u2014";
	const dur = detail.durationSeconds
		? `${Math.round(detail.durationSeconds / 60)} min`
		: "\u2014";
	const tokens = detail.totalInputTokens + detail.totalOutputTokens;

	const msgs = detail.messages
		.map((m) => {
			const isUser = m.role === "user";
			const isTool = m.role === "tool";
			const cls = isUser ? "msg msg-user" : isTool ? "msg msg-tool" : "msg msg-assistant";
			const roleLabel = isUser ? "You" : isTool ? (m.toolName ? escapeHtml(m.toolName) : "Tool") : "Assistant";
			const ts = m.timestamp ? `<div class="msg-ts">${escapeHtml(new Date(m.timestamp).toLocaleTimeString())}</div>` : "";
			return `<div class="${cls}">
<div class="msg-role">${roleLabel}</div>
${escapeHtml(m.content)}${ts}
</div>`;
		})
		.join("");

	return renderLayout(title, `
<div class="section section-dark">
<div class="container">
<div class="session-header">
<div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
<h1 class="tile-heading">${escapeHtml(title)}</h1>
${sourceBadge(detail.source)}
</div>
<div class="session-meta">
<div class="session-meta-item"><div class="meta-label">Project</div><div class="meta-value">${escapeHtml(detail.projectName ?? "\u2014")}</div></div>
<div class="session-meta-item"><div class="meta-label">Started</div><div class="meta-value">${escapeHtml(started)}</div></div>
<div class="session-meta-item"><div class="meta-label">Duration</div><div class="meta-value">${escapeHtml(dur)}</div></div>
<div class="session-meta-item"><div class="meta-label">Messages</div><div class="meta-value">${detail.messageCount}</div></div>
<div class="session-meta-item"><div class="meta-label">Tokens</div><div class="meta-value">${tokens.toLocaleString()}</div></div>
</div>
</div>
<div style="display:flex;flex-direction:column;gap:4px">
${msgs}
</div>
</div>
</div>
<a href="#" onclick="window.scrollTo({top:0,behavior:'smooth'});return false" class="scroll-top">\u2191</a>
`);
}

export function renderSessionsPage(
	sessions: SessionSummary[],
	source?: string,
	project?: string,
): string {
	const pills = SOURCE_OPTIONS.map((s) => {
		const label = s === "all" ? "All" : s === "claude-code" ? "Claude Code" : s === "opencode" ? "OpenCode" : "OpenClaw";
		const active = (source ?? "all") === s ? " active" : "";
		return `<a href="/sessions?source=${s}&project=${encodeURIComponent(project ?? "")}" class="pill${active}">${label}</a>`;
	}).join("");

	let tableHtml: string;
	if (sessions.length === 0) {
		tableHtml = '<p class="empty">No sessions found.</p>';
	} else {
		const rows = sessions
			.map((s) => {
				const title = s.title || s.projectName || "Untitled";
				const date = s.startedAt ? new Date(s.startedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "\u2014";
				const tokens = s.totalInputTokens + s.totalOutputTokens;
				return `<tr>
<td><a href="/session/${escapeHtml(s.id)}">${escapeHtml(title)}</a></td>
<td>${sourceBadge(s.source)}</td>
<td style="color:var(--text-secondary)">${escapeHtml(s.projectName ?? "\u2014")}</td>
<td style="text-align:right;color:var(--text-secondary)">${s.messageCount}</td>
<td style="text-align:right;color:var(--text-secondary)">${tokens.toLocaleString()}</td>
<td style="color:var(--text-secondary)">${escapeHtml(date)}</td>
</tr>`;
			})
			.join("");
		tableHtml = `<div class="table-wrap"><table>
<thead><tr><th>Session</th><th>Source</th><th>Project</th><th style="text-align:right">Messages</th><th style="text-align:right">Tokens</th><th>Date</th></tr></thead>
<tbody>${rows}</tbody>
</table></div>`;
	}

	return renderLayout("Sessions", `
<div class="section section-dark">
<div class="container">
<h1 class="heading" style="margin-bottom:32px">Sessions</h1>
<form method="GET" action="/sessions" style="display:flex;align-items:center;gap:12px;margin-bottom:32px;flex-wrap:wrap">
<div class="pill-group">${pills}</div>
<input type="text" name="project" value="${escapeHtml(project ?? "")}" placeholder="Filter by project\u2026" class="search-input" style="max-width:280px;padding:8px 18px;font-size:14px">
<input type="hidden" name="source" value="${escapeHtml(source ?? "all")}" id="source-input">
<button type="submit" class="btn-primary" style="font-size:14px;padding:8px 20px">Filter</button>
</form>
${tableHtml}
</div>
</div>

<script>
document.querySelectorAll('.pill').forEach(function(p){
p.addEventListener('click',function(e){
e.preventDefault();
document.getElementById('source-input').value=new URL(this.href).searchParams.get('source')||'all';
document.querySelectorAll('.pill').forEach(function(x){x.classList.remove('active')});
this.classList.add('active');
this.closest('form').submit();
});
});
</script>
`);
}
