// Custom TUI searchable model picker. Bypasses pi's flaky autocomplete popup
// for multi-level extension commands by giving the user a reliable, searchable
// list. Type to filter (fuzzy on id+name), up/down to navigate,
// enter to pick, esc to cancel.
//
// Implementation mirrors pi's own ModelSelectorComponent (a Container with an
// embedded Input + a repopulated listContainer, using fuzzyFilter + the
// keybindings manager). Critically, handleInput() uses
// `getKeybindings().matches(data, "tui.select.up")` — the TUI delivers RAW
// terminal escape sequences to handleInput (e.g. "\x1b[A" for Up), NOT parsed
// key names like "up". Comparing `data === "up"` never matches (that was the
// freeze bug). matchesKey/KeybindingsManager do the parsing.
//
// The component classes are defined inside the async open* functions (after the
// dynamic host import) so `Container`/`Input` are in scope at declaration time.
// A top-level `class ... extends Container` would fail at module load because
// the host import is async and the class declaration runs before it resolves.
//
// Per tui.md "Container Components with Embedded Inputs": a Container that
// embeds an Input must implement Focusable and propagate `focused` to the Input
// so the hardware cursor (IME) positions correctly.

import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function getHostDistDir(): string {
	return dirname(realpathSync(process.argv[1]));
}
function hostUrl(rel: string): string {
	return pathToFileURL(resolve(getHostDistDir(), rel)).href;
}

export interface PickerItem {
	/** Value returned on select (the model.id token). */
	id: string;
	/** Primary display label. */
	label: string;
	/** Optional secondary (muted) hint, e.g. the note or the id. */
	hint?: string;
	/** Text fuzzy-matched against the filter query. */
	searchText: string;
}

async function loadTui() {
	const mod: any = await import(
		hostUrl("../node_modules/@earendil-works/pi-tui/dist/index.js")
	);
	return mod as {
		Container: any;
		Text: any;
		Spacer: any;
		Input: any;
		fuzzyFilter: <T>(items: T[], query: string, getText: (item: T) => string) => T[];
		getKeybindings: () => { matches: (data: string, keybinding: string) => boolean };
	};
}

const MAX_VISIBLE = 10;

/**
 * Open the searchable model picker. Resolves with the selected model id, or
 * undefined if the user cancelled (esc / ctrl+c) or there were no items.
 * Pass `items` to override the default (all available models) — used by the
 * annotated-model picker for `get`/`rm`.
 */
export async function openModelPicker(
	ctx: any,
	opts: { items?: PickerItem[]; title?: string } = {},
): Promise<string | undefined> {
	if (!ctx.ui?.custom) {
		ctx.ui?.notify?.("Model picker requires the interactive TUI session", "error");
		return undefined;
	}
	const tui = await loadTui();
	const { Container, Text, Spacer, Input, fuzzyFilter, getKeybindings } = tui;

	let items: PickerItem[];
	if (opts.items) {
		items = opts.items;
	} else {
		const models: any[] = ctx.modelRegistry?.getAvailable?.() ?? [];
		if (models.length === 0) {
			ctx.ui.notify("No models available in the registry", "error");
			return undefined;
		}
		items = models.map((m: any) => ({
			id: m.id,
			label: m.name && m.name !== m.id ? m.name : m.id,
			hint: m.name && m.name !== m.id ? m.id : undefined,
			searchText: `${m.id} ${m.name ?? ""}`,
		}));
	}
	const title = opts.title ?? "Select a model";

	class ModelPickerComponent extends Container {
		private items: PickerItem[];
		private filtered: PickerItem[];
		private filter: string = "";
		private selectedIndex: number = 0;
		private done: (r: string | undefined) => void;
		private theme: any;
		private searchInput: any;
		private listContainer: any;

		constructor(items: PickerItem[], theme: any, done: (r: string | undefined) => void) {
			super();
			this.items = items;
			this.filtered = items;
			this.theme = theme;
			this.done = done;

			this.addChild(new Text(theme.fg("accent", theme.bold("  " + title)), 0, 0));
			this.addChild(new Spacer(1));

			this.searchInput = new Input();
			this.searchInput.onSubmit = () => {
				const sel = this.filtered[this.selectedIndex];
				if (sel) this.done(sel.id);
			};
			this.addChild(this.searchInput);
			this.addChild(new Spacer(1));

			this.listContainer = new Container();
			this.addChild(this.listContainer);
			this.addChild(new Spacer(1));
			this.addChild(
				new Text(
					theme.fg("muted", "  ↑↓ navigate · type to filter · enter select · esc cancel"),
					0,
					0,
				),
			);

			this.populate();
		}

		// Focusable: propagate focus to the embedded Input for IME cursor.
		private _focused = false;
		get focused() {
			return this._focused;
		}
		set focused(value: boolean) {
			this._focused = value;
			this.searchInput.focused = value;
		}

		private populate() {
			this.listContainer.clear();
			const t = this.theme;

			if (this.filtered.length === 0) {
				this.listContainer.addChild(new Text(t.fg("muted", "  No matching models"), 0, 0));
				return;
			}
			if (this.selectedIndex >= this.filtered.length) this.selectedIndex = this.filtered.length - 1;
			if (this.selectedIndex < 0) this.selectedIndex = 0;

			const start = Math.max(
				0,
				Math.min(
					this.selectedIndex - Math.floor(MAX_VISIBLE / 2),
					this.filtered.length - MAX_VISIBLE,
				),
			);
			const end = Math.min(start + MAX_VISIBLE, this.filtered.length);
			for (let i = start; i < end; i++) {
				const m = this.filtered[i];
				const isSel = i === this.selectedIndex;
				const label = m.hint ? `${m.label}  ${t.fg("muted", m.hint)}` : m.label;
				const line = isSel
					? `${t.fg("accent", "→ ")}${t.fg("accent", label)}`
					: `  ${label}`;
				this.listContainer.addChild(new Text(line, 0, 0));
			}
			if (start > 0 || end < this.filtered.length) {
				this.listContainer.addChild(
					new Text(t.fg("muted", `  (${this.selectedIndex + 1}/${this.filtered.length})`), 0, 0),
				);
			}
		}

		handleInput(data: string) {
			const kb = getKeybindings();
			if (kb.matches(data, "tui.select.up")) {
				if (this.filtered.length === 0) return;
				this.selectedIndex =
					this.selectedIndex === 0 ? this.filtered.length - 1 : this.selectedIndex - 1;
				this.populate();
			} else if (kb.matches(data, "tui.select.down")) {
				if (this.filtered.length === 0) return;
				this.selectedIndex =
					this.selectedIndex === this.filtered.length - 1 ? 0 : this.selectedIndex + 1;
				this.populate();
			} else if (kb.matches(data, "tui.select.confirm")) {
				const sel = this.filtered[this.selectedIndex];
				if (sel) this.done(sel.id);
			} else if (kb.matches(data, "tui.select.cancel")) {
				this.done(undefined);
			} else {
				this.searchInput.handleInput(data);
				this.applyFilter();
			}
		}

		private applyFilter() {
			const q = this.searchInput.getValue();
			this.filtered = q ? fuzzyFilter(this.items, q, (m) => m.searchText) : this.items;
			this.selectedIndex = 0;
			this.populate();
		}
	}

	return ctx.ui.custom<string | undefined>(
		(_tui: any, theme: any, _kb: any, done: (r: string | undefined) => void) => {
			return new ModelPickerComponent(items, theme, done);
		},
	);
}

/**
 * Open a picker showing ONLY models that already have an annotation. Used by
 * `get` and `rm` so the user picks from existing notes, not all 350+ models.
 * The note is shown as a hint on each row.
 */
export async function openAnnotatedModelPicker(
	ctx: any,
	load: () => Record<string, string>,
	opts: { title?: string } = {},
): Promise<string | undefined> {
	const map = load();
	const keys = Object.keys(map);
	if (keys.length === 0) {
		ctx.ui?.notify?.("No annotations yet. Use /model-annotations set to add one.", "info");
		return undefined;
	}
	const items: PickerItem[] = keys.map((k) => ({
		id: k,
		label: k,
		hint: map[k],
		searchText: `${k} ${map[k]}`,
	}));
	return openModelPicker(ctx, { items, title: opts.title ?? "Select an annotated model" });
}

// ── Read-only list view (e.g. show all annotations) ─────────────────
/**
 * Open a navigable read-only TUI list overlay. Closes on esc / enter / q /
 * ctrl-c. Falls back to a single notify (lines joined by newlines) in non-TUI
 * modes.
 */
export async function openListView(
	ctx: any,
	title: string,
	lines: string[],
): Promise<void> {
	if (!ctx.ui?.custom) {
		ctx.ui?.notify?.(lines.join("\n"), "info");
		return;
	}
	const tui = await loadTui();
	const { Container, Text, Spacer, getKeybindings } = tui;

	class ListViewComponent extends Container {
		private lines: string[];
		private title: string;
		private done: () => void;
		private theme: any;
		private listContainer: any;
		private selectedIndex: number = 0;

		constructor(lines: string[], title: string, theme: any, done: () => void) {
			super();
			this.lines = lines;
			this.title = title;
			this.theme = theme;
			this.done = done;

			this.addChild(new Text(theme.fg("accent", theme.bold("  " + this.title)), 0, 0));
			this.addChild(new Spacer(1));

			this.listContainer = new Container();
			this.addChild(this.listContainer);
			this.addChild(new Spacer(1));
			this.addChild(new Text(theme.fg("muted", "  esc / enter / q to close"), 0, 0));

			this.populate();
		}

		private populate() {
			this.listContainer.clear();
			const t = this.theme;
			if (this.lines.length === 0) {
				this.listContainer.addChild(new Text(t.fg("muted", "  (empty)"), 0, 0));
				return;
			}
			if (this.selectedIndex >= this.lines.length) this.selectedIndex = this.lines.length - 1;
			if (this.selectedIndex < 0) this.selectedIndex = 0;

			const start = Math.max(
				0,
				Math.min(
					this.selectedIndex - Math.floor(MAX_VISIBLE / 2),
					this.lines.length - MAX_VISIBLE,
				),
			);
			const end = Math.min(start + MAX_VISIBLE, this.lines.length);
			for (let i = start; i < end; i++) {
				const isSel = i === this.selectedIndex;
				const line = isSel
					? `${t.fg("accent", "→ ")}${t.fg("accent", this.lines[i])}`
					: `  ${this.lines[i]}`;
				this.listContainer.addChild(new Text(line, 0, 0));
			}
		}

		handleInput(data: string) {
			const kb = getKeybindings();
			if (
				kb.matches(data, "tui.select.cancel") ||
				kb.matches(data, "tui.select.confirm") ||
				data === "q"
			) {
				this.done();
			} else if (kb.matches(data, "tui.select.up")) {
				this.selectedIndex =
					this.selectedIndex === 0 ? this.lines.length - 1 : this.selectedIndex - 1;
				this.populate();
			} else if (kb.matches(data, "tui.select.down")) {
				this.selectedIndex =
					this.selectedIndex === this.lines.length - 1 ? 0 : this.selectedIndex + 1;
				this.populate();
			}
		}
	}

	await ctx.ui.custom<void>((_tui: any, theme: any, _kb: any, done: () => void) => {
		return new ListViewComponent(lines, title, theme, done);
	});
}
