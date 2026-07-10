// `/model-annotations` editor command.
//
// Interactive (no args): subcommand select -> searchable model picker -> note input.
// Command-line (args):  power-user shortcut (list / set / rm).
//
// `list` shows all annotations and opens the highlighted one for editing (a
// one-stop browse+edit view). There is no `get` — `list` covers it: picking an
// entry opens the note editor prefilled.
//
// IMPORTANT wiring note: the factory-time `pi` (ExtensionAPI returned by
// `createExtensionAPI` in pi's loader) does NOT expose `modelRegistry` at runtime
// (the types promise it, but the runtime api object omits it). The
// ModelRegistry is only available on the command-handler `ctx` and on event
// contexts. So we read the model list from `ctx.modelRegistry` in the handler
// and cache it in a closure for `getArgumentCompletions` (tab completion),
// which receives no `ctx`.

import { loadAnnotations, saveAnnotations } from "./storage.js";
import { openModelPicker, openAnnotatedModelPicker } from "./picker.js";

export function registerModelAnnotationsCommand(
	pi: any,
	path: string,
	load: () => Record<string, string>,
	save: (m: Record<string, string>) => void,
): void {
	const SUBS = ["list", "set", "rm"] as const;
	// Subcommands that take a <model-id> as their next argument.
	const MODEL_ARG_SUBS = new Set(["set", "rm"]);

	// Cached available models, populated lazily from ctx.modelRegistry on first
	// command use. getArgumentCompletions has no `ctx` (pi's provider calls it
	// with only the argument prefix), so it must read from this cache.
	let cachedModels: any[] | null = null;

	const getModelCompletions = (modelPrefix: string): any[] | null => {
		const models = cachedModels ?? [];
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
			"Manage model annotations shown in /model. Run with no args for the interactive picker.",
		getArgumentCompletions: (argumentText: string): any => {
			const raw = argumentText ?? "";
			const endsWithSpace = raw.length > 0 && /\s$/.test(raw);
			const tokens = raw.trim() === "" ? [] : raw.trim().split(/\s+/);
			if (tokens.length === 0) {
				return SUBS.map((s) => ({ value: s, label: s }));
			}
			if (tokens.length === 1 && !endsWithSpace) {
				const p = tokens[0].toLowerCase();
				const subs = SUBS.filter((s) => s.toLowerCase().startsWith(p));
				return subs.length > 0 ? subs.map((s) => ({ value: s, label: s })) : null;
			}
			const sub = tokens[0];
			if (!MODEL_ARG_SUBS.has(sub)) return null;
			if (tokens.length === 1) return getModelCompletions("");
			if (tokens.length === 2 && !endsWithSpace) return getModelCompletions(tokens[1]);
			return null;
		},
		handler: async (args: string, ctx: any) => {
			// Refresh the model cache from ctx.modelRegistry on every invocation.
			// getAvailable() is auth-filtered and matches what /model shows.
			cachedModels = ctx.modelRegistry?.getAvailable?.() ?? [];

			if (args.trim() === "") {
				return runInteractiveFlow(ctx, load, save);
			}
			return runCommandLine(args, ctx, load, save);
		},
	});
}

// ── Interactive flow (no args) ────────────────────────────────────────
async function runInteractiveFlow(
	ctx: any,
	load: () => Record<string, string>,
	save: (m: Record<string, string>) => void,
) {
	if (!ctx.hasUI) {
		ctx.ui.notify(
			"Run /model-annotations in the interactive session, or pass a subcommand (list/set/rm).",
			"info",
		);
		return;
	}
	const choice = await ctx.ui.select(
		"Model annotations — what do you want to do?",
		["list", "set", "rm"],
	);
	if (!choice) return;
	if (choice === "list") return doList(ctx, load, save);
	if (choice === "rm") {
		const id = await openAnnotatedModelPicker(ctx, load);
		if (!id) return;
		return doRm(ctx, load, save, id);
	}
	if (choice === "set") {
		const id = await openModelPicker(ctx);
		if (!id) return;
		return doSet(ctx, load, save, id);
	}
}

// ── Command-line flow (args) ─────────────────────────────────────────
async function runCommandLine(
	args: string,
	ctx: any,
	load: () => Record<string, string>,
	save: (m: Record<string, string>) => void,
) {
	const tokens = args.trim().split(/\s+/).filter(Boolean);
	const sub = (tokens[0] || "list").toLowerCase();
	const fail = (msg: string) => ctx.ui.notify(msg, "error");
	if (sub === "list") return doList(ctx, load, save);
	if (sub === "rm") {
		const id = tokens[1];
		if (!id) return fail("Usage: /model-annotations rm <model-id>");
		// Power-user shortcut: no confirm dialog.
		return doRm(ctx, load, save, id, { skipConfirm: true });
	}
	if (sub === "set") {
		const id = tokens[1];
		if (!id) return fail("Usage: /model-annotations set <model-id> <note...>");
		return doSet(ctx, load, save, id, { noteArg: tokens.slice(2).join(" ") });
	}
	return fail(`Unknown subcommand '${sub}'. Try: list | set | rm`);
}

// ── Shared actions ───────────────────────────────────────────────────
// `list`: browse all annotations and edit the highlighted one. The list view
// IS the annotated-model picker — selecting an entry opens it for editing via
// doSet (prefilled with the current note). Esc closes without editing.
async function doList(
	ctx: any,
	load: () => Record<string, string>,
	save: (m: Record<string, string>) => void,
) {
	const map = load();
	const keys = Object.keys(map);
	if (keys.length === 0) {
		return ctx.ui.notify(
			"No model annotations yet. Run /model-annotations (no args) to add one.",
			"info",
		);
	}
	const id = await openAnnotatedModelPicker(ctx, load, {
		title: `Annotations (${keys.length}) — enter to edit`,
	});
	if (!id) return;
	return doSet(ctx, load, save, id);
}

async function doRm(
	ctx: any,
	load: () => Record<string, string>,
	save: (m: Record<string, string>) => void,
	id: string,
	opts: { skipConfirm?: boolean } = {},
) {
	const map = load();
	if (!(id in map)) return ctx.ui.notify(`No annotation for ${id}`, "warning");
	if (!opts.skipConfirm && ctx.hasUI) {
		const ok = await ctx.ui.confirm(
			"Remove annotation?",
			`Remove the annotation for ${id}?`,
		);
		if (!ok) return;
	}
	delete map[id];
	save(map);
	return ctx.ui.notify(`Removed annotation for ${id}`, "info");
}

async function doSet(
	ctx: any,
	load: () => Record<string, string>,
	save: (m: Record<string, string>) => void,
	id: string,
	opts: { noteArg?: string } = {},
) {
	const existing = load()[id] ?? "";
	let note = (opts.noteArg ?? "").trim();
	if (!note && ctx.hasUI) {
		const input = await ctx.ui.input(`Annotation for ${id}:`, existing);
		if (input === undefined) return; // cancelled
		note = input;
	}
	if (!note) return ctx.ui.notify("Empty note; nothing saved.", "error");
	const map = load();
	map[id] = note;
	save(map);
	return ctx.ui.notify(`Saved annotation for ${id}`, "info");
}
