import type { Database } from "bun:sqlite";
import type { SourceAdapter } from "../../adapters/types";
import type { CursorState } from "../../types";
import { runSync } from "../../core/sync";

interface SyncArgs {
	source?: string;
}

export async function handleSync(
	args: SyncArgs,
	db: Database,
	adapters: SourceAdapter[],
	cursorState: CursorState,
) {
	const result = await runSync(db, adapters, cursorState, {
		source: args.source,
	});

	const lines = [
		`Sync complete: ${result.totalParsed} parsed, ${result.totalSkipped} skipped, ${result.totalFiles} files`,
	];

	if (result.errors.length > 0) {
		lines.push(`Errors (${result.errors.length}):`);
		for (const e of result.errors) {
			lines.push(`  - ${e}`);
		}
	}

	return {
		content: [{ type: "text" as const, text: lines.join("\n") }],
	};
}
