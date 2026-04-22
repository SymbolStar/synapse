import type { Database } from "bun:sqlite";
import { addTag, removeTag, listTags, searchByTag } from "../../core/tags";

interface TagArgs {
	action: "add" | "remove" | "list" | "search";
	session_id?: string;
	tag?: string;
	limit?: number;
}

export function handleTag(args: TagArgs, db: Database) {
	if (args.action === "search") {
		if (!args.tag) {
			return { content: [{ type: "text" as const, text: "Missing 'tag' for search." }] };
		}
		const results = searchByTag(db, args.tag, args.limit);
		if (results.length === 0) {
			return { content: [{ type: "text" as const, text: "No sessions found with that tag." }] };
		}
		const lines = results.map((r) => {
			const tags = r.tags.map((t) => `#${t}`).join(" ");
			return `[${r.source}] ${r.title ?? "(untitled)"}\n  Session: ${r.sessionId}\n  ${r.projectName ?? ""} | ${r.startedAt}\n  Tags: ${tags}`;
		});
		return { content: [{ type: "text" as const, text: lines.join("\n\n") }] };
	}

	if (!args.session_id) {
		return { content: [{ type: "text" as const, text: "Missing 'session_id'." }] };
	}

	if (args.action === "list") {
		const tags = listTags(db, args.session_id);
		if (tags.length === 0) {
			return { content: [{ type: "text" as const, text: "No tags for this session." }] };
		}
		return { content: [{ type: "text" as const, text: tags.map((t) => `#${t}`).join(" ") }] };
	}

	if (!args.tag) {
		return { content: [{ type: "text" as const, text: "Missing 'tag'." }] };
	}

	if (args.action === "add") {
		addTag(db, args.session_id, args.tag);
		return { content: [{ type: "text" as const, text: `Tagged ${args.session_id} with #${args.tag}` }] };
	}

	if (args.action === "remove") {
		removeTag(db, args.session_id, args.tag);
		return { content: [{ type: "text" as const, text: `Removed #${args.tag} from ${args.session_id}` }] };
	}

	return { content: [{ type: "text" as const, text: "Unknown action." }] };
}
