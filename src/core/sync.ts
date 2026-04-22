import type { Database } from "bun:sqlite";
import type { SourceAdapter } from "../adapters/types";
import type { CursorState, SyncResult } from "../types";
import { getFingerprint } from "../adapters/fingerprint";
import { indexParseResults } from "./indexer";

export async function runSync(
	db: Database,
	adapters: SourceAdapter[],
	cursorState: CursorState,
	opts?: { source?: string },
): Promise<SyncResult> {
	let totalParsed = 0;
	let totalSkipped = 0;
	let totalFiles = 0;
	const errors: string[] = [];

	const filtered = opts?.source
		? adapters.filter((a) => a.source === opts.source)
		: adapters;

	for (const adapter of filtered) {
		let files: string[];
		try {
			files = await adapter.discover();
		} catch (err) {
			errors.push(`discover failed for ${adapter.source}: ${err}`);
			continue;
		}

		for (const filePath of files) {
			totalFiles++;
			try {
				const fingerprint = await getFingerprint(filePath);
				const cursor = cursorState.files[filePath];

				if (adapter.shouldSkip(cursor, fingerprint)) {
					totalSkipped++;
					continue;
				}

				const results = await adapter.parse(
					filePath,
					cursor?.offset ?? 0,
				);

				if (results.length > 0) {
					indexParseResults(db, results);
					totalParsed += results.length;
				}

				cursorState.files[filePath] = adapter.buildCursor(
					fingerprint,
					results,
				);
				cursorState.updatedAt = new Date().toISOString();
			} catch (err) {
				errors.push(`${filePath}: ${err}`);
			}
		}
	}

	return { totalParsed, totalSkipped, totalFiles, errors };
}
