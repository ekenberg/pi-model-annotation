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
	// Subcommands that take a <model-id> as their next argument.
	const MODEL_ARG_SUBS = new Set(["get", "set", "add", "edit", "rm", "remove", "delete"]);
	// Build model completion items filtered by prefix (matches value OR label).
	const getModelCompletions = (modelPrefix: string): any[] | null => {
		const models: any[] = pi.modelRegistry?.getAll?.() ?? [];
		const items = models.map((m: any) => ({
			value: m.id,
			label: m.name && m.name !== m.id ? m.name : m.id,
		}));
		if (!modelPrefix) return items.length > 0 ? items : null;
		const p = modelPrefix.toLowerCase();
		const matched = items.filter(
			(i: any) =>
				i.value.toLowerCase().startsWith(p) || (i.label || "").toLowerCase().startsWith(p),
		);
		return matched.length > 0 ? matched : null;
	};
	pi.registerCommand("model-annotations", {
		description:
			"Manage model annotations shown in /model (list | get | set | rm <model-id> <note>)",
		// The provider hands us the ENTIRE text after the first space, across all argument
		// levels. Our command has two levels: <subcommand> then <model-id>. We must
		// decide which level the cursor is at from the raw text + trailing space.
		getArgumentCompletions: (argumentText: string): any => {
			const raw = argumentText ?? "";
			const endsWithSpace = raw.length > 0 && /\s$/.test(raw);
			const tokens = raw.trim() === "" ? [] : raw.trim().split(/\s+/);

			// Level 0: no subcommand yet -> subcommand list.
			if (tokens.length === 0) {
				return SUBS.map((s) => ({ value: s, label: s }));
			}

			// Level 1 (typing the subcommand): no trailing space -> still at subcommand level.
			if (tokens.length === 1 && !endsWithSpace) {
				const p = tokens[0].toLowerCase();
				const subs = SUBS.filter((s) => s.toLowerCase().startsWith(p));
				return subs.length > 0 ? subs.map((s) => ({ value: s, label: s })) : null;
			}

			// Subcommand is committed; from here on, only model-arg subcommands have more.
			const sub = tokens[0];
			if (!MODEL_ARG_SUBS.has(sub)) {
				return null; // e.g. "list " -> no further argument
			}

			// Level 2: model id.
			//   tokens.length === 1 with trailing space -> model level, empty prefix.
			//   tokens.length === 2, no trailing space -> model level, prefix = tokens[1].
			if (tokens.length === 1) {
				return getModelCompletions("");
			}
			if (tokens.length === 2 && !endsWithSpace) {
				return getModelCompletions(tokens[1]);
			}

			// Past the model id: <note...> for set/add/edit, or done for get/rm/remove/delete.
			return null;
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
