import type { Database } from "bun:sqlite";
import { getProjectSummary } from "../../core/search";

interface ProjectSummaryArgs {
	project?: string;
	days?: number;
}

export function handleProjectSummary(args: ProjectSummaryArgs, db: Database) {
	const summary = getProjectSummary(db, {
		project: args.project,
		days: args.days,
	});

	const lines: string[] = [
		`Sessions (last ${args.days ?? 7} days): ${summary.totalSessions}`,
	];

	if (Object.keys(summary.bySource).length > 0) {
		lines.push(
			`By source: ${Object.entries(summary.bySource).map(([s, n]) => `${s}=${n}`).join(", ")}`,
		);
	}

	if (summary.recentSessions.length > 0) {
		lines.push("", "Recent:");
		for (const s of summary.recentSessions) {
			const project = s.projectName ? ` ${s.projectName}` : "";
			const title = s.title ? ` — ${s.title}` : "";
			lines.push(`  [${s.source}]${project}${title} (${s.startedAt})`);
		}
	}

	return {
		content: [{ type: "text" as const, text: lines.join("\n") }],
	};
}
