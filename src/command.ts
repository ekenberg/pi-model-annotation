// `/model-annotations` editor command.
// Usage:
//   /model-annotations                  -> list all
//   /model-annotations get <model-id>      -> show one
//   /model-annotations set <model-id> <note...>   -> upsert (prompts if note omitted)
//   /model-annotations add <p/id> <note...>    -> alias of set
//   /model-annotations rm  <model-id>      -> remove

import { loadAnnotations, saveAnnotations } from "./storage.js";

export function registerModelAnnotationsCommand(
	pi: any,
	path: string,
	load: () => Record<string, string>,
	save: (m: Record<string, string>) => void,
): void {
	const SUBS = ["list", "get", "set", "add", "edit", "rm", "remove", "delete"] as const;
	pi.registerCommand("model-annotations", {
		description:
			"Manage model annotations shown in /model (list | get | set | rm <model-id> <note>)",
		getArgumentCompletions: (prefix: string): any => {
			const p = (prefix || "").toLowerCase();
			// Empty prefix -> assume 1st token (subcommand) to avoid dumping 350 model ids.
			if (p === "") {
				return SUBS.map((s) => ({ value: s, label: s }));
			}
			// If the prefix still matches a subcommand start, treat as 1st token.
			const subMatches = SUBS.filter((s) => s.startsWith(p));
			if (subMatches.length > 0) {
				return subMatches.map((s) => ({ value: s, label: s }));
			}
			// Otherwise -> 2nd token: complete model ids from the registry.
			const models: any[] = pi.modelRegistry?.getAll?.() ?? [];
			const items = models.map((m: any) => ({
				value: m.id,
				label: m.name && m.name !== m.id ? m.name : m.id,
			}));
			const matched = items.filter(
				(i: any) =>
					i.value.toLowerCase().startsWith(p) ||
					(i.label || "").toLowerCase().startsWith(p),
			);
			return matched.length > 0 ? matched : null;
		},
		handler: async (args: string, ctx: any) => {
			const tokens = args.trim().split(/\s+/).filter(Boolean);
			const sub = (tokens[0] || "list").toLowerCase();
			const fail = (msg: string) => ctx.ui.notify(msg, "error");

			if (sub === "list") {
				const map = load();
				const keys = Object.keys(map);
				if (keys.length === 0) {
					return ctx.ui.notify(
						"No model annotations yet. Add one: /model-annotations set openrouter/anthropic/claude-sonnet-4 \"Cheap, good toolcalling\"",
						"info",
					);
				}
				const lines = keys.map((k) => `${k}\n    ${map[k]}`);
				return ctx.ui.notify(lines.join("\n"), "info");
			}

			if (sub === "get") {
				const key = tokens[1];
				if (!key) return fail("Usage: /model-annotations get <model-id>");
				const note = load()[key];
				return ctx.ui.notify(
					note ? `${key}: ${note}` : `No annotation for ${key}`,
					note ? "info" : "warning",
				);
			}

			if (sub === "rm" || sub === "remove" || sub === "delete") {
				const key = tokens[1];
				if (!key) return fail("Usage: /model-annotations rm <model-id>");
				const map = load();
				if (!(key in map)) return ctx.ui.notify(`No annotation for ${key}`, "warning");
				delete map[key];
				save(map);
				return ctx.ui.notify(`Removed annotation for ${key}`, "info");
			}

			if (sub === "set" || sub === "add" || sub === "edit") {
				const key = tokens[1];
				if (!key) return fail("Usage: /model-annotations set <model-id> <note...>");
				let note = tokens.slice(2).join(" ");
				if (!note && ctx.hasUI) {
					const existing = load()[key] ?? "";
					const input = await ctx.ui.input(`Annotation for ${key}:`, existing);
					if (input === undefined) return; // cancelled
					note = input;
				}
				if (!note) return fail("Empty note; provide text or cancel.");
				const map = load();
				map[key] = note;
				save(map);
				return ctx.ui.notify(`Saved annotation for ${key}`, "info");
			}

			return fail(`Unknown subcommand '${sub}'. Try: list | get | set | rm`);
		},
	});
}
