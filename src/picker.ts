// Custom TUI searchable model picker. Bypasses pi's flaky autocomplete popup
// for multi-level extension commands by giving the user a reliable, searchable
// list. Type to filter (substring on id or name), up/down to navigate,
// enter to pick, esc to cancel.
//
// The component class is defined inside `openModelPicker` (after the dynamic
// host import) so `Container` is in scope at declaration time. A top-level
// `class ... extends Container` would fail at module load because the host
// import is async and the class declaration runs before it resolves.

import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function getHostDistDir(): string {
	return dirname(realpathSync(process.argv[1]));
}
function hostUrl(rel: string): string {
	return pathToFileURL(resolve(getHostDistDir(), rel)).href;
}

/**
 * Open the model picker. Resolves with the selected model id, or undefined
 * if the user cancelled (esc / ctrl+c) or there are no models.
 */
export async function openModelPicker(pi: any, ctx: any): Promise<string | undefined> {
	if (!ctx.ui?.custom) {
		ctx.ui?.notify?.("Model picker requires the interactive TUI session", "error");
		return undefined;
	}
	const tuiMod: any = await import(
		hostUrl("../node_modules/@earendil-works/pi-tui/dist/index.js")
	);
	const { Container, Text, Spacer } = tuiMod;
	const models: any[] = pi.modelRegistry?.getAvailable?.() ?? [];
	if (models.length === 0) {
		ctx.ui.notify("No models available in the registry", "error");
		return undefined;
	}
	const items = models.map((m: any) => ({ id: m.id, name: m.name }));

	// Define the component class inside this function so `Container` is in scope.
	class ModelPickerComponent extends Container {
		private items: { id: string; name?: string }[];
		private filter: string = "";
		private selectedIndex: number = 0;
		private done: (r: string | undefined) => void;
		private theme: any;
		private maxVisible = 10;

		constructor(
			items: { id: string; name?: string }[],
			theme: any,
			done: (r: string | undefined) => void,
		) {
			super();
			this.items = items;
			this.theme = theme;
			this.done = done;
			this.render();
		}

		private get filtered(): { id: string; name?: string }[] {
			const f = this.filter.toLowerCase();
			if (!f) return this.items;
			return this.items.filter(
				(m) =>
					m.id.toLowerCase().includes(f) ||
					(m.name && m.name.toLowerCase().includes(f)),
			);
		}

		private render() {
			this.clear();
			const t = this.theme;
			// Filter line
			const filterLine =
				(t ? t.fg("accent", "  Filter: ") : "  Filter: ") + this.filter + "█";
			this.addChild(new Text(filterLine, 0, 0));
			this.addChild(new Spacer(1));

			const items = this.filtered;
			if (items.length === 0) {
				this.addChild(
					new Text((t ? t.fg("muted", "  no matches") : "  no matches"), 0, 0),
				);
			} else {
				if (this.selectedIndex >= items.length) this.selectedIndex = items.length - 1;
				if (this.selectedIndex < 0) this.selectedIndex = 0;

				const start = Math.max(
					0,
					Math.min(
						this.selectedIndex - Math.floor(this.maxVisible / 2),
						items.length - this.maxVisible,
					),
				);
				const end = Math.min(start + this.maxVisible, items.length);
				for (let i = start; i < end; i++) {
					const m = items[i];
					const isSel = i === this.selectedIndex;
					const label =
						m.name && m.name !== m.id
							? `${m.name}  ${t ? t.fg("muted", m.id) : m.id}`
							: m.id;
					const prefix = isSel ? (t ? t.fg("accent", "→ ") : "→ ") : "  ";
					const text = isSel && t ? t.fg("accent", label) : label;
					this.addChild(new Text(prefix + text, 0, 0));
				}
				this.addChild(new Spacer(1));
				const hint = `  ${items.length} match${items.length === 1 ? "" : "es"}  ·  type to filter  ·  ↑↓ navigate  ·  enter select  ·  esc cancel`;
				this.addChild(new Text((t ? t.fg("muted", hint) : hint), 0, 0));
			}
		}

		handleInput(data: string) {
			if (data === "escape" || data === "ctrl+c") {
				this.done(undefined);
				return;
			}
			if (data === "return" || data === "enter" || data === "kpenter") {
				const items = this.filtered;
				if (items.length > 0) this.done(items[this.selectedIndex].id);
				else this.done(undefined);
				return;
			}
			if (data === "up") {
				const items = this.filtered;
				if (items.length > 0) {
					this.selectedIndex = Math.max(0, this.selectedIndex - 1);
					this.render();
				}
				return;
			}
			if (data === "down") {
				const items = this.filtered;
				if (items.length > 0) {
					this.selectedIndex = Math.min(items.length - 1, this.selectedIndex + 1);
					this.render();
				}
				return;
			}
			if (data === "backspace") {
				if (this.filter.length > 0) {
					this.filter = this.filter.slice(0, -1);
					this.selectedIndex = 0;
					this.render();
				}
				return;
			}
			if (data.length === 1 && data.charCodeAt(0) >= 32) {
				this.filter += data;
				this.selectedIndex = 0;
				this.render();
			}
		}
	}

	return ctx.ui.custom<string | undefined>(
		(_tui: any, theme: any, _kb: any, done: (r: string | undefined) => void) => {
			return new ModelPickerComponent(items, theme, done);
		},
	);
}

// ── Read-only list view (e.g. show all annotations) ─────────────────
/**
 * Open a read-only TUI list overlay. Closes on esc / enter / q / ctrl-c.
 * Falls back to a single notify (lines joined by newlines) in non-TUI modes.
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
	const tuiMod: any = await import(
		hostUrl("../node_modules/@earendil-works/pi-tui/dist/index.js"),
	);
	const { Container, Text, Spacer } = tuiMod;

	class ListViewComponent extends Container {
		private lines: string[];
		private title: string;
		private done: () => void;
		private theme: any;

		constructor(lines: string[], title: string, theme: any, done: () => void) {
			super();
			this.lines = lines;
			this.title = title;
			this.theme = theme;
			this.done = done;
			this.render();
		}

		private render() {
			this.clear();
			const t = this.theme;
			this.addChild(
				new Text(
					t ? t.fg("accent", "  " + this.title) : "  " + this.title,
					0,
					0,
				),
			);
			this.addChild(new Spacer(1));
			if (this.lines.length === 0) {
				this.addChild(
					new Text(t ? t.fg("muted", "  (empty)") : "  (empty)", 0, 0),
				);
			} else {
				for (const line of this.lines) {
					this.addChild(new Text("  " + line, 0, 0));
				}
			}
			this.addChild(new Spacer(1));
			this.addChild(
				new Text(
					t ? t.fg("muted", "  esc / enter / q to close") : "  esc / enter / q to close",
					0,
					0,
				),
			);
		}

		handleInput(data: string) {
			if (
				data === "escape" ||
				data === "return" ||
				data === "enter" ||
				data === "kpenter" ||
				data === "ctrl+c" ||
				data === "q"
			) {
				this.done();
				return;
			}
		}
	}

	await ctx.ui.custom<void>((_tui: any, theme: any, _kb: any, done: () => void) => {
		return new ListViewComponent(lines, title, theme, done);
	});
}
