// Unified annotation editor: a single interactive component that replaces the
// old subcommand/command-line architecture. `/model-annotations` (no args)
// opens this; there are no other entry points.
//
// Three internal modes in one `ctx.ui.custom` component (the promise stays
// unresolved until final exit — pi keeps focus throughout):
//   - LIST: a single fuzzy-filtered list. Annotated models sort to the top
//     with a ★ marker and their note as a hint; all other available models
//     follow. Orphaned annotations (model no longer in the registry) still
//     appear at the top. Enter → edit mode. Ctrl+D → confirm mode.
//   - EDIT: an embedded pi-tui `Input` (NOT ctx.ui.input — that cannot
//     prefill: ExtensionInputComponent ignores its placeholder arg, so
//     editInput.setValue(existingNote) is the only way to prefill). Enter =
//     save (non-empty) → return to list. Esc = cancel → return to list.
//     Ctrl+D → confirm mode. Empty+Enter = cancel (NOT delete — safe against
//     accidental loss).
//   - CONFIRM: inline deletion prompt (NOT ctx.ui.confirm — that destroys
//     the custom component by replacing editorContainer). y/Enter = delete →
//     return to list. n/Esc = cancel → return to previous mode (list or edit).
//
// Key handling uses getKeybindings().matches() and matchesKey() — the TUI
// delivers RAW terminal escape sequences to handleInput (e.g. "\x1b[A" for
// Up), not parsed key names. Comparing `data === "up"` never matches.
//
// `Container implements Focusable` per tui.md "Container Components with
// Embedded Inputs": `focused` propagates to the active Input (searchInput in
// list mode, editInput in edit mode) so the hardware cursor positions for IME.
//
// The component class is defined inside openAnnotationEditor (after the dynamic
// host import) so `Container`/`Input` are in scope at declaration time.

import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function getHostDistDir(): string {
	return dirname(realpathSync(process.argv[1]));
}
function hostUrl(rel: string): string {
	return pathToFileURL(resolve(getHostDistDir(), rel)).href;
}

interface EditorItem {
	/** model.id token (the annotation key). */
	id: string;
	/** primary display label (model name, or id for orphans). */
	label: string;
	/** muted hint shown after the label (the note, or the id for named models). */
	hint?: string;
	/** text fuzzy-matched against the filter query. */
	searchText: string;
	/** whether this model has an annotation (drives the ★ marker + sort). */
	annotated: boolean;
}

const MAX_VISIBLE = 10;

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
		matchesKey: (data: string, key: string) => boolean;
		Key: { ctrl: (k: string) => string };
	};
}

/**
 * Open the annotation editor. Resolves when the user exits (Esc in list mode).
 */
export async function openAnnotationEditor(
	ctx: any,
	load: () => Record<string, string>,
	save: (m: Record<string, string>) => void,
): Promise<void> {
	if (!ctx.ui?.custom) {
		ctx.ui?.notify?.("Annotation editor requires the interactive TUI session", "error");
		return;
	}
	const tui = await loadTui();
	const { Container, Text, Spacer, Input, fuzzyFilter, getKeybindings, matchesKey, Key } = tui;

	class AnnotationEditorComponent extends Container {
		private mode: "list" | "edit" | "confirm" = "list";
		private items: EditorItem[] = [];
		private filtered: EditorItem[] = [];
		private selectedIndex: number = 0;
		private editingId: string = "";
		private confirmingId: string = "";
		private returnMode: "list" | "edit" = "list";
		private theme: any;
		private tui: any;
		private ctx: any;
		private load: () => Record<string, string>;
		private save: (m: Record<string, string>) => void;
		private done: () => void;

		private searchInput: any;
		private editInput: any;
		private listContainer: any;

		constructor(
			theme: any,
			tui: any,
			ctx: any,
			load: () => Record<string, string>,
			save: (m: Record<string, string>) => void,
			done: () => void,
		) {
			super();
			this.theme = theme;
			this.tui = tui;
			this.ctx = ctx;
			this.load = load;
			this.save = save;
			this.done = done;

			this.searchInput = new Input();
			this.listContainer = new Container();

			this.rebuildItems();
			this.applyFilter();
			this.buildListChildren();
		}

		// ── Focusable: propagate to the active-mode Input ──────────────
		private _focused = false;
		get focused() {
			return this._focused;
		}
		set focused(value: boolean) {
			this._focused = value;
			if (this.mode === "confirm") return; // no Input in confirm mode
			const input = this.mode === "edit" ? this.editInput : this.searchInput;
			if (input) input.focused = value;
		}

		// ── Items ───────────────────────────────────────────────────────
		// Annotated (from load()) sorted to top with ★; then all available
		// models minus annotated. Orphans (annotated but not in registry)
		// appear at the top with their key as label.
		private rebuildItems() {
			const notes = this.load();
			const annotatedIds = new Set(Object.keys(notes));
			const items: EditorItem[] = [];

			// Build a registry lookup so annotated models in the registry show
			// their name (not just the id token).
			this.ctx.modelRegistry?.refresh?.();
			const models: any[] = this.ctx.modelRegistry?.getAvailable?.() ?? [];
			const registryById = new Map<string, any>(
				models.map((m: any) => [m.id, m]),
			);

			// Annotated first (includes orphans).
			for (const id of annotatedIds) {
				const model = registryById.get(id);
				const name = model?.name && model.name !== id ? model.name : undefined;
				items.push({
					id,
					label: name ?? id,
					hint: name ? `${id}  —  ${notes[id]}` : notes[id],
					searchText: `${id} ${name ?? ""} ${notes[id]}`,
					annotated: true,
				});
			}

			// Then all available models not already annotated.
			for (const m of models) {
				if (annotatedIds.has(m.id)) continue;
				items.push({
					id: m.id,
					label: m.name && m.name !== m.id ? m.name : m.id,
					hint: m.name && m.name !== m.id ? m.id : undefined,
					searchText: `${m.id} ${m.name ?? ""}`,
					annotated: false,
				});
			}

			this.items = items;
		}

		private applyFilter() {
			const q = this.searchInput.getValue();
			this.filtered = q ? fuzzyFilter(this.items, q, (m) => m.searchText) : this.items;
			if (this.selectedIndex >= this.filtered.length) {
				this.selectedIndex = Math.max(0, this.filtered.length - 1);
			}
		}

		// ── List mode rendering ─────────────────────────────────────────
		private buildListChildren() {
			this.clear();
			const t = this.theme;
			this.addChild(new Text(t.fg("accent", t.bold("  Model Annotations")), 0, 0));
			this.addChild(new Spacer(1));
			this.addChild(this.searchInput);
			this.addChild(new Spacer(1));
			this.addChild(this.listContainer);
			this.addChild(new Spacer(1));
			this.addChild(
				new Text(
					t.fg(
						"muted",
						"  ↑↓ navigate · type to filter · enter edit · ctrl+d delete · esc exit",
					),
					0,
					0,
				),
			);
			this.populateList();
		}

		private populateList() {
			this.listContainer.clear();
			const t = this.theme;

			if (this.filtered.length === 0) {
				const msg = this.items.length === 0 ? "No models available" : "No matching models";
				this.listContainer.addChild(new Text(t.fg("muted", `  ${msg}`), 0, 0));
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
				const marker = m.annotated ? t.fg("accent", "★ ") : "  ";
				const label = m.hint ? `${m.label}  ${t.fg("muted", m.hint)}` : m.label;
				const line = isSel
					? `${t.fg("accent", "→ ")}${marker}${t.fg("accent", label)}`
					: `${"  "}${marker}${label}`;
				this.listContainer.addChild(new Text(line, 0, 0));
			}
			if (start > 0 || end < this.filtered.length) {
				this.listContainer.addChild(
					new Text(t.fg("muted", `  (${this.selectedIndex + 1}/${this.filtered.length})`), 0, 0),
				);
			}
		}

		// ── Edit mode ──────────────────────────────────────────────────
		private enterEditMode(id: string) {
			this.mode = "edit";
			this.editingId = id;
			const existing = this.load()[id] ?? "";

			this.editInput = new Input();
			this.editInput.setValue(existing);
			// Place cursor at end so editing an existing note feels natural
			// (Input constructor sets cursor=0; setValue clamps, not moves, it).
			this.editInput.cursor = existing.length;
			this.editInput.onSubmit = (value: string) => {
				const trimmed = value.trim();
				if (!trimmed) {
					// Empty + Enter = cancel (not delete — safe against accidental loss).
					this.returnToList();
					return;
				}
				this.saveNote(id, trimmed);
				this.returnToList();
			};
			this.editInput.onEscape = () => {
				this.returnToList();
			};

			this.buildEditChildren();
			// Focus propagation: tui may have already set focused=true on us;
			// ensure the edit input reflects it.
			if (this._focused) this.editInput.focused = true;
		}

		private buildEditChildren() {
			this.clear();
			const t = this.theme;
			this.addChild(
				new Text(t.fg("accent", t.bold(`  Annotation for ${this.editingId}`)), 0, 0),
			);
			this.addChild(new Spacer(1));
			this.addChild(this.editInput);
			this.addChild(new Spacer(1));
			this.addChild(
				new Text(
					t.fg(
						"muted",
						"  enter save · esc cancel · ctrl+d delete · empty+enter=cancel",
					),
					0,
					0,
				),
			);
		}

		private enterConfirmMode(id: string, fromMode: "list" | "edit") {
			if (!this.load()[id]) return; // nothing to delete
			this.mode = "confirm";
			this.confirmingId = id;
			this.returnMode = fromMode;
			this.buildConfirmChildren();
		}

		private buildConfirmChildren() {
			this.clear();
			const t = this.theme;
			this.addChild(
				new Text(
					t.fg("warning", t.bold(`  Delete annotation for ${this.confirmingId}?`)),
					0,
					0,
				),
			);
			this.addChild(new Spacer(1));
			this.addChild(
				new Text(t.fg("muted", "  y/enter confirm · n/esc cancel"), 0, 0),
			);
		}

		private confirmDelete() {
			const id = this.confirmingId;
			const map = this.load();
			if (id in map) {
				delete map[id];
				this.save(map);
				this.refreshFooterWidget(id, undefined);
			}
			this.confirmingId = "";
			// After delete, always return to list (the annotation is gone,
			// nothing to edit).
			this.returnToList();
		}

		private cancelConfirm() {
			const wasInEdit = this.returnMode === "edit";
			this.confirmingId = "";
			if (wasInEdit) {
				this.mode = "edit";
				this.buildEditChildren();
				if (this._focused) this.editInput.focused = true;
			} else {
				this.mode = "list";
				this.buildListChildren();
				if (this._focused) this.searchInput.focused = true;
			}
		}

		private returnToList() {
			this.mode = "list";
			this.editInput = undefined;
			this.editingId = "";
			this.rebuildItems();
			this.applyFilter();
			this.buildListChildren();
			if (this._focused) this.searchInput.focused = true;
		}

		private saveNote(id: string, note: string) {
			const map = this.load();
			map[id] = note;
			this.save(map);
			this.refreshFooterWidget(id, note);
		}

		// Fix the footer-widget staleness bug: the widget only auto-updates on
		// model_select, so if we just edited the ACTIVE model's annotation we
		// must refresh it ourselves.
		private refreshFooterWidget(id: string, note: string | undefined) {
			const active = this.ctx?.model?.id;
			if (id === active) {
				this.ctx?.ui?.setWidget?.(
					"model-annotations",
					note ? [id, note] : undefined,
				);
			}
		}

		// ── Input ───────────────────────────────────────────────────────
		handleInput(data: string) {
			const kb = getKeybindings();

			// Confirm mode: inline deletion prompt (no ctx.ui.confirm —
			// that destroys the custom component's DOM).
			if (this.mode === "confirm") {
				if (kb.matches(data, "tui.select.confirm") || data === "y" || data === "Y") {
					this.confirmDelete();
				} else if (
					kb.matches(data, "tui.select.cancel") ||
					data === "n" ||
					data === "N"
				) {
					this.cancelConfirm();
				}
				return;
			}

			if (this.mode === "edit") {
				// Ctrl+D in edit view = delete (intercepted BEFORE the Input
				// sees it as forward-delete).
				if (matchesKey(data, Key.ctrl("d"))) {
					this.enterConfirmMode(this.editingId, "edit");
					return;
				}
				// Everything else (Enter, Esc, typing) goes to the edit Input.
				this.editInput.handleInput(data);
				return;
			}

			// List mode.
			if (kb.matches(data, "tui.select.up")) {
				if (this.filtered.length === 0) return;
				this.selectedIndex =
					this.selectedIndex === 0 ? this.filtered.length - 1 : this.selectedIndex - 1;
				this.populateList();
			} else if (kb.matches(data, "tui.select.down")) {
				if (this.filtered.length === 0) return;
				this.selectedIndex =
					this.selectedIndex === this.filtered.length - 1 ? 0 : this.selectedIndex + 1;
				this.populateList();
			} else if (kb.matches(data, "tui.select.confirm")) {
				const sel = this.filtered[this.selectedIndex];
				if (sel) this.enterEditMode(sel.id);
			} else if (kb.matches(data, "tui.select.cancel")) {
				this.done();
			} else if (matchesKey(data, Key.ctrl("d"))) {
				// List-level delete on the highlighted annotated model.
				const sel = this.filtered[this.selectedIndex];
				if (sel && sel.annotated) {
					this.enterConfirmMode(sel.id, "list");
				}
			} else {
				this.searchInput.handleInput(data);
				this.applyFilter();
				this.populateList();
			}
		}
	}

	await ctx.ui.custom<void>((tui: any, theme: any, _kb: any, done: () => void) => {
		return new AnnotationEditorComponent(theme, tui, ctx, load, save, done);
	});
}
