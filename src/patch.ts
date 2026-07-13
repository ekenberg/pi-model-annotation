// Runtime patch of pi's ModelSelectorComponent.updateList, mirroring the
// proven technique from the installed `pi-model-selector-x` package.
// We do NOT edit pi's dist files: the host module is imported at runtime,
// the prototype method is wrapped (call original, then append), and the
// patch is removed on session_shutdown. This survives `pi update`.
//
// Stacking-proof teardown (see STATUS.md §5.x — duplicate detail panes):
// pi re-inits extensions on every session/reload (newSession/fork/
// switchSession/reload) within one long-lived process, and the component
// prototype is shared (ESM module cache). When TWO extensions wrap the same
// `updateList` (here: `pi-model-selector-x` AND this one) with an
// outermost-only unpatch guard, the inner wrapper cannot remove itself when it
// is not outermost — it gets ORPHANED into the chain and re-wrapped next cycle,
// stacking one extra appended detail pane (card) per cycle. That is the
// "duplicate cards in /model" bug.
//
// Fix: capture pi's pristine `updateList` ONCE, and on teardown reset the whole
// prototype back to pristine (a full unwind of the wrapper chain) instead of a
// polite single-layer restore. Every cycle then starts from a clean prototype,
// so nothing accumulates. Install-time idempotency still does a *polite*
// self-removal so we chain on top of selector-x's card within a cycle.

const PATCH_KEY = Symbol.for("pi-model-annotation:update-list");
// Cache of pi's original, unwrapped updateList (stashed on the prototype).
const PRISTINE_KEY = Symbol.for("pi-model-annotation:pristine-update-list");
// pi-model-selector-x's public patch record — read only to peel its layer when
// recovering the pristine method. Absence is fine (we just see fewer layers).
const SX_PATCH_KEY = Symbol.for("pi-model-selector-x:update-list-patch");

type GetNote = (key: string) => string | undefined;

type PatchRecord = { original: (...args: any[]) => any; patched: (...args: any[]) => any };

// Recover pi's pristine updateList by peeling wrapper layers we can recognize
// (ours + pi-model-selector-x). Cached on the prototype so it is computed once,
// on the first clean load, where a single peel reaches the true original.
//
// NOTE: this is only guaranteed pristine when first run in a CLEAN process
// (fresh `pi` start). Hot-reloading this fix into an already-duplicated process
// cannot recover the buried original — do one full restart after deploying.
function resolvePristineUpdateList(proto: any): ((...args: any[]) => any) | undefined {
	const cached = proto[PRISTINE_KEY];
	if (typeof cached === "function") return cached;

	let fn = proto.updateList;
	const seen = new Set<unknown>();
	while (typeof fn === "function" && !seen.has(fn)) {
		seen.add(fn);
		const ours: PatchRecord | undefined = proto[PATCH_KEY];
		if (ours && fn === ours.patched && typeof ours.original === "function") {
			fn = ours.original;
			continue;
		}
		const sx: PatchRecord | undefined = proto[SX_PATCH_KEY];
		if (sx && fn === sx.patched && typeof sx.original === "function") {
			fn = sx.original;
			continue;
		}
		break;
	}

	if (typeof fn === "function") {
		proto[PRISTINE_KEY] = fn;
		return fn;
	}
	return undefined;
}

// Polite, single-layer removal of OUR wrapper only (keeps other patches such as
// selector-x's card intact). Used for install-time idempotency.
function removeOwnLayer(proto: any): void {
	const rec: PatchRecord | undefined = proto[PATCH_KEY];
	if (!rec) return;
	if (proto.updateList === rec.patched) {
		proto.updateList = rec.original;
	}
	delete proto[PATCH_KEY];
}

// Full teardown: reset the shared prototype to pi's pristine updateList,
// unwinding the ENTIRE wrapper chain. This is what prevents cross-extension
// wrapper accumulation. Falls back to a polite restore if pristine was never
// captured.
function resetToPristine(proto: any): void {
	const pristine = proto[PRISTINE_KEY];
	if (typeof pristine === "function") {
		proto.updateList = pristine;
		delete proto[PATCH_KEY];
		return;
	}
	removeOwnLayer(proto);
}

export function installModelAnnotationsPatch(
	ModelSelectorComponent: any,
	theme: any,
	Text: any,
	Spacer: any,
	getNote: GetNote,
): () => void {
	const proto = ModelSelectorComponent.prototype;

	// Capture pi's pristine method before we (or a re-install) wrap it.
	resolvePristineUpdateList(proto);

	// Idempotent: drop any previous copy of OUR wrapper, but keep other patches
	// (e.g. selector-x) so we chain on top of their card within this cycle.
	removeOwnLayer(proto);

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

	// Teardown resets to pristine (full unwind) — see file header.
	return () => resetToPristine(proto);
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
