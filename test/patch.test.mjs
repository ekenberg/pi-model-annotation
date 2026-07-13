// Regression test for the duplicate /model detail-pane bug.
//
// Bug: pi re-inits extensions every session/reload cycle. Both this extension
// and `pi-model-selector-x` wrap the shared
// `ModelSelectorComponent.prototype.updateList`. With an outermost-only unpatch
// on both, the first-loaded wrapper (selector-x) cannot restore itself when it
// is not outermost -> it is orphaned and re-wrapped next cycle, stacking one
// extra detail card per `/reload`.
//
// Fix (src/patch.ts): teardown resets the whole prototype to pi's pristine
// `updateList` (full chain unwind), so nothing accumulates across cycles.
//
// This harness drives real session/reload cycles against a fake prototype
// using the REAL annotation patch plus a faithful mimic of selector-x's patch,
// and asserts the selector-x card count stays at 1. A negative control (a
// buggy, outermost-only annotation teardown) proves the harness actually
// detects accumulation.
//
// No build step / deps: Node (>=22) strips the TS types from ../src/patch.ts.
// Run: `node --test test/patch.test.mjs`  (or `npm test`).

import { test } from "node:test";
import assert from "node:assert/strict";

import { installModelAnnotationsPatch } from "../src/patch.ts";

// ── Minimal fakes mirroring pi-tui shapes the patch touches ──────────────────

class Text {
	constructor(text) {
		this.text = text;
	}
	setText(t) {
		this.text = t;
	}
}
class Spacer {
	constructor(n) {
		this.size = n;
	}
}
class ListContainer {
	constructor() {
		this.children = [];
	}
	clear() {
		this.children = [];
	}
	addChild(c) {
		this.children.push(c);
	}
}

// theme.fg is identity so appended text stays plain and matchable.
const theme = { fg: (_role, s) => s };

const MODELS = [{ id: "anthropic/claude-fable-5", provider: "anthropic", name: "Claude Fable 5" }];
const NOTE = "Best local model";
const getNote = (key) => (key === MODELS[0].id ? NOTE : undefined);

const SX_CARD = "SX-CARD"; // selector-x's detail card marker
const ANN_PANE = "Annotations"; // annotation detail-pane label (see src/patch.ts)

// pi's pristine updateList: clears, re-adds rows, then a "Model Name" line.
function pristineUpdateList() {
	this.listContainer.clear();
	for (const m of this.filteredModels) {
		this.listContainer.addChild(new Text(`  ${m.id} [${m.provider}]`));
	}
	const selected = this.filteredModels[this.selectedIndex];
	this.listContainer.addChild(new Spacer(1));
	this.listContainer.addChild(new Text(`  Model Name: ${selected.name}`));
}

function makeSelector() {
	return { filteredModels: MODELS, selectedIndex: 0, listContainer: new ListContainer() };
}

// ── Faithful mimic of pi-model-selector-x's patch (outermost-only unpatch) ───

const SX_SYM = Symbol.for("pi-model-selector-x:update-list-patch");
function installSelectorX(klass) {
	const proto = klass.prototype;
	uninstallSelectorX(klass);
	const original = proto.updateList;
	const patched = function () {
		original.call(this);
		this.listContainer.addChild(new Text(SX_CARD));
	};
	proto.updateList = patched;
	proto[SX_SYM] = { original, patched };
	return () => uninstallSelectorX(klass);
}
function uninstallSelectorX(klass) {
	const proto = klass.prototype;
	const p = proto[SX_SYM];
	if (!p) return;
	if (proto.updateList === p.patched) proto.updateList = p.original; // outermost-only
	delete proto[SX_SYM];
}

// ── Negative control: the OLD buggy annotation patch (outermost-only) ────────

const BUGGY_SYM = Symbol.for("test:buggy-annotation-update-list");
function installBuggyAnnotation(klass) {
	const proto = klass.prototype;
	const original = proto.updateList;
	const patched = function () {
		original.call(this);
		const selected = this.filteredModels[this.selectedIndex];
		if (getNote(selected.id)) this.listContainer.addChild(new Text(ANN_PANE));
	};
	proto.updateList = patched;
	proto[BUGGY_SYM] = { original, patched };
	return () => {
		const p = proto[BUGGY_SYM];
		if (!p) return;
		if (proto.updateList === p.patched) proto.updateList = p.original; // outermost-only (the bug)
		delete proto[BUGGY_SYM];
	};
}

// ── Cycle driver ─────────────────────────────────────────────────────────────
// Each cycle: install both patches in `order`, render, then run their teardown
// handlers in registration order (pi fires session_shutdown handlers in the
// order they were registered = extension load order).

function runCycles({ installAnnotation, order, cycles = 5 }) {
	const klass = { prototype: { updateList: pristineUpdateList } };
	const cardCounts = [];
	const paneCounts = [];

	for (let c = 0; c < cycles; c++) {
		const teardowns = [];
		if (order === "sx-first") {
			teardowns.push(installSelectorX(klass));
			teardowns.push(installAnnotation(klass));
		} else {
			teardowns.push(installAnnotation(klass));
			teardowns.push(installSelectorX(klass));
		}

		const sel = makeSelector();
		klass.prototype.updateList.call(sel);
		const isPane = (ch) => typeof ch.text === "string" && ch.text.includes(ANN_PANE);
		cardCounts.push(sel.listContainer.children.filter((ch) => ch.text === SX_CARD).length);
		paneCounts.push(sel.listContainer.children.filter(isPane).length);

		for (const t of teardowns) t(); // session_shutdown, registration order
	}
	return { cardCounts, paneCounts };
}

const realAnnotation = (klass) => installModelAnnotationsPatch(klass, theme, Text, Spacer, getNote);

// ── Tests ────────────────────────────────────────────────────────────────────

test("negative control: buggy outermost-only teardown DOES accumulate (harness sanity)", () => {
	const { cardCounts } = runCycles({ installAnnotation: installBuggyAnnotation, order: "sx-first" });
	// One extra selector-x card per cycle — the exact bug.
	assert.deepEqual(cardCounts, [1, 2, 3, 4, 5], `expected accumulation, got ${cardCounts}`);
});

test("fixed patch: selector-x first — exactly one card every cycle", () => {
	const { cardCounts, paneCounts } = runCycles({ installAnnotation: realAnnotation, order: "sx-first" });
	assert.ok(
		cardCounts.every((n) => n === 1),
		`detail card must not accumulate; got ${cardCounts}`,
	);
	// Annotation pane must still render (functionality preserved) — never lost, never doubled.
	assert.ok(
		paneCounts.every((n) => n === 1),
		`annotation pane must render exactly once each cycle; got ${paneCounts}`,
	);
});

test("fixed patch: annotation first — exactly one card every cycle", () => {
	const { cardCounts, paneCounts } = runCycles({ installAnnotation: realAnnotation, order: "ann-first" });
	assert.ok(
		cardCounts.every((n) => n === 1),
		`detail card must not accumulate; got ${cardCounts}`,
	);
	assert.ok(
		paneCounts.every((n) => n === 1),
		`annotation pane must render exactly once each cycle; got ${paneCounts}`,
	);
});

test("fixed patch: inline tag applied to the annotated row", () => {
	const klass = { prototype: { updateList: pristineUpdateList } };
	installSelectorX(klass);
	realAnnotation(klass);
	const sel = makeSelector();
	klass.prototype.updateList.call(sel);
	const row = sel.listContainer.children.find(
		(ch) => typeof ch.text === "string" && ch.text.includes(MODELS[0].id) && ch.text.includes("["),
	);
	assert.ok(row, "annotated row should exist");
	assert.ok(row.text.includes(NOTE), `row should carry the inline note tag; got: ${row.text}`);
});
