// Runtime patch of pi's ModelSelectorComponent.updateList, mirroring the
// proven technique from the installed `pi-model-selector-x` package.
// We do NOT edit pi's dist files: the host module is imported at runtime,
// the prototype method is wrapped (call original, then append), and the
// patch is removed on session_shutdown. This survives `pi update`.

const PATCH_KEY = Symbol.for("pi-model-annotation:update-list");

type GetNote = (key: string) => string | undefined;

export function installModelAnnotationsPatch(
	ModelSelectorComponent: any,
	theme: any,
	Text: any,
	Spacer: any,
	getNote: GetNote,
): () => void {
	const proto = ModelSelectorComponent.prototype;
	uninstallModelAnnotationsPatch(ModelSelectorComponent); // idempotent

	const original = proto.updateList;
	const patched = function (this: any) {
		original.call(this);
		try {
			appendAnnotations(this, theme, Text, Spacer, getNote);
		} catch {
			// enhancement failure must never break the selector
		}
	};

	proto.updateList = patched;
	proto[PATCH_KEY] = { original, patched };
	return () => uninstallModelAnnotationsPatch(ModelSelectorComponent);
}

function uninstallModelAnnotationsPatch(ModelSelectorComponent: any): void {
	const proto = ModelSelectorComponent.prototype;
	const p = proto[PATCH_KEY];
	if (!p) return;
	if (proto.updateList === p.patched) {
		proto.updateList = p.original;
	}
	delete proto[PATCH_KEY];
}

function appendAnnotations(
	selector: any,
	theme: any,
	Text: any,
	Spacer: any,
	getNote: GetNote,
): void {
	if (!theme) return;
	const fm = selector.filteredModels;
	if (!fm || fm.length === 0) return;
	const listContainer = selector.listContainer;
	if (!listContainer) return;

	// --- INLINE tag on each annotated row -------------------------------
	// Rows are rebuilt fresh every render (updateList calls clear()), so we
	// only ever see pi's own row texts here (no stale appended children).
	const children = listContainer.children;
	if (Array.isArray(children)) {
		for (const child of children) {
			const t: unknown = (child as any)?.text;
			if (typeof t !== "string") continue;
			// pi wraps both the model id and the provider badge in theme.fg(...), so the
			// raw row text contains ANSI SGR codes between the space and the `[`. Strip
			// them so the row regex and id lookup can match plain text.
			const plain: string = t.replace(/\x1b\[[0-9;]*m/g, "");
			if (plain.includes("Model Name:")) continue; // skip footer line
			if (!/^\s*(→\s*)?\S/.test(plain)) continue; // only row-like lines
			const m = plain.match(/(?:→\s*)?(\S+?)\s+\[([^\]]+)\]/);
			if (!m) continue;
			const note = getNote(m[1]);
			if (!note) continue;
			if (plain.includes("—")) continue; // already tagged (defensive)
			// Keep the inline tag short so long notes don't wreck the row; full note is in the detail pane.
			const MAX_INLINE = 40;
			const shortNote =
				note.length > MAX_INLINE
					? note.slice(0, MAX_INLINE).replace(/[\s,;:.-]+\S*$/, "") + "…"
					: note;
			// Append to the original (styled) text so the row's existing colors are preserved.
			(child as any).setText(t + theme.fg("muted", "  —  " + shortNote));
		}
	}

	// --- DETAIL pane for the highlighted model --------------------------
	const selected = fm[selector.selectedIndex];
	if (!selected) return;
	const key = selected.id; // === model.id === the id token shown in the row
	const note = getNote(key);
	if (!note) return;

	listContainer.addChild(new Spacer(1));
	listContainer.addChild(new Text(theme.fg("border", "  " + "─".repeat(50)), 0, 0));
	listContainer.addChild(new Text(theme.fg("muted", "  Annotations"), 0, 0));
	listContainer.addChild(new Text("  " + theme.fg("accent", note), 0, 0));
}
