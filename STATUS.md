# pi-model-annotation — Status & Handoff

*Session: 2026-07-10. Built with AI assistance (transparently AI-generated; see README).*

This is the handoff document for the next session. Read §5 (gotchas), §7 (known issues), and §9 (future work) before changing anything.

---

## 1. What this is

A [pi](https://github.com/badlogic/pi) extension that lets you attach a short *"why is this model here / usecase"* note to any model in your scoped set, and shows those notes in two places inside pi:

1. **In the built-in `/model` selector** — an inline `  —  note` tag on every annotated row, and a fuller detail pane (separator + bold model name + full note) under the list for the currently highlighted model.
2. **As a footer widget for the active model** — when you switch models, the active model's note (if any) is shown via `ctx.ui.setWidget`.

The goal: a human with 350+ available models can remember *why* a particular model is in their scoped set (e.g. "cheap toolcalling", "image classification") without consulting an external note.

## 2. Intended user experience (the PRIMARY path)

```
$ /model-annotations        (no arguments — just press Enter)
```

1. pi shows a small select dialog with the subcommands: `list`, `get`, `set`, `rm`.
2. The user picks, say, `set`.
3. A **searchable model picker TUI** opens: type-to-filter (substring on id and name, case-insensitive), ↑/↓ to navigate, Enter to pick, Esc to cancel. Windowed to ~10 visible rows with scroll.
4. The user picks a model (e.g. types `glm`, arrows to the GLM model, Enter).
5. A text input dialog opens, pre-filled with the model's current note. The user edits it and presses Enter.
6. The note is saved to `~/.pi/agent/model-annotations.json` and a confirmation is notified.
7. Next `/model` shows the inline tag and detail pane.

Command-line forms (`/model-annotations set <id> "note"`, `rm <id>`, `get <id>`, `list`) remain as a **power-user shortcut** — they route through the same shared `doList`/`doGet`/`doRm`/`doSet` helpers. `rm` via the command line skips the confirm dialog (power user); the interactive `rm` confirms via `ctx.ui.confirm`.

`/model-annotations` (no args) is the recommended path because it bypasses pi's flaky multi-level autocomplete popup for extension commands (see §5.6).

## 3. Repo layout

```
pi-model-annotation/
├── AGENTS.md           lean repo orientation (conventions, verified constraint, hard rules)
├── DEV.md              design notes (mechanism, branches, edit loop) — partly stale, see §9
├── README.md           install + usage (user-facing)
├── STATUS.md           this file (handoff / current state)
├── package.json        pi package manifest (pi.extensions: ["./index.ts"])
├── index.ts            extension entry factory: resolves host modules (pi-tui, ModelSelectorComponent),
│                       installs the /model monkeypatch, registers the command, wires
│                       model_select → footer widget
└── src/
    ├── storage.ts      loadAnnotations / saveAnnotations on ~/.pi/agent/model-annotations.json
    ├── patch.ts        installModelAnnotationsPatch — runtime-monkeypatches
    │                   ModelSelectorComponent.updateList to append inline tag + detail pane
    ├── picker.ts       openModelPicker (searchable model TUI) + openListView (read-only list TUI)
    └── command.ts      /model-annotations: no-args interactive flow + command-line form,
                        both routing through shared doList/doGet/doRm/doSet
```

Workspace = source of truth. Installed globally via `pi install git:git@github.com:ekenberg/pi-model-annotation@live`. Branches: `main` (canonical) and `live` (install branch). Edit on `live`; `git push origin live:main` to publish.

## 4. Verified constraint (why this approach is non-trivial)

pi exposes **no official extension hook** into the `/model` list rendering, and `Model` has no `notes` field. The proven technique (used by the installed `pi-model-selector-x` package) is to **runtime-monkeypatch** `ModelSelectorComponent.prototype.updateList`: at extension load, dynamically import pi's own bundled `modes/interactive/components/model-selector.js` (resolved from `dirname(realpathSync(process.argv[1]))`), wrap `updateList` so it calls the original and then appends our annotation, and unpatch on `session_shutdown`. The patch chains safely with other patches (idempotent uninstall-first). No edits to pi's dist files on disk — survives `pi update`.

## 5. Key implementation gotchas (learned the hard way — read before changing)

### 5.1 `pi.modelRegistry` is undefined in the factory
The TypeScript types promise `ExtensionAPI.modelRegistry: ModelRegistry`, but the **runtime** `api` object that pi's `createExtensionAPI` (in `dist/core/extensions/loader.js`) hands to the factory does **not** include `modelRegistry`. The `ModelRegistry` is only available on the **command-handler `ctx`** (and event contexts), via a getter in the runner. So **never** do `pi.modelRegistry.getAvailable()` in the factory — it's `undefined`. Always read the model list from `ctx.modelRegistry.getAvailable()` in the command handler.

For `getArgumentCompletions` (tab completion), pi's provider calls it with only the argument prefix string — no `ctx`. So the command handler refreshes a closure-cached model list on every invocation (from `ctx.modelRegistry.getAvailable()`), and the tab-completion code reads from that cache. This is how `command.ts` works.

### 5.2 Never override `render()` on a pi-tui Component
pi-tui's `Container` has a `render(width)` method that the TUI calls to draw the component. It iterates `this.children` and concatenates each child's `render(width)` output. If you override `render` and just do `clear()` + `addChild()` + return `undefined`, the inherited render never runs and the TUI gets `undefined` lines → crash with `TypeError: childLines is not iterable`. **Do not override `render`.** Give the populate logic a different name (e.g. `populate()`), call it from the constructor and on each input change, and let the inherited `Container.render` do the drawing. This bit me in both `ModelPickerComponent` and `ListViewComponent`; the fix is in place.

### 5.3 ANSI codes in `/model` row text
pi's `ModelSelectorComponent` builds each row as `` `${theme.fg("accent", modelText)} ${providerBadge}${checkmark}` `` — so the raw `child.text` contains ANSI SGR codes wrapping the id AND the provider badge, with the `[` of the badge preceded by an escape, not a space. Any regex like `/\s+\[([^\]]+)\]/` that expects `space + [provider]` will silently never match. **Always strip ANSI SGR codes** (`s.replace(/\x1b\[[0-9;]*m/g, "")`) from the row text before matching. Use the original (styled) text for `setText` so the row's existing colors are preserved. This is what makes the inline tag in `/model` actually appear.

### 5.4 `Container` class scope at module load
If you use `extends Container` at the **top level** of a module, the class declaration runs at module load time — but if `Container` is only available after an `await import(...)` inside a function, the top-level `extends` fails with `Container is not defined`. Define the class **inside** the function (after the dynamic import) so the base class is in scope. This bit me in `picker.ts` — fixed by defining `ModelPickerComponent` and `ListViewComponent` inside `openModelPicker`/`openListView`.

### 5.5 pi-tui components are imported dynamically from the host
The extension has **no `dependencies`** in `package.json` (pi git-packages install with `--omit=dev`, and adding bare specifier deps can pull in 140+ host transitive packages). Instead, every `pi-tui` import in the extension is done **dynamically at runtime** from the host's own `node_modules`:

```ts
import(pathToFileURL(resolve(
  dirname(realpathSync(process.argv[1])),
  "../node_modules/@earendil-works/pi-tui/dist/index.js"
)).href)
```

This guarantees the SAME copy of `pi-tui` the host uses, with no version drift and no install-time bloat. `index.ts` does this for `ModelSelectorComponent` + `theme` + `Text`/`Spacer`. `picker.ts` does it for `Container`/`Text`/`Spacer`. Use the same pattern for any future pi-tui usage.

### 5.6 pi's tab-completion state machine is unreliable for multi-level extension commands
The `!options.force` gate in pi's autocomplete provider deliberately bypasses argument completions for forced Tab in any slash-argument context (after a space), and the `tryTriggerAutocomplete` re-bootstrap after a tab-accept is flaky. This is why the recommended path is `/model-annotations` (no args) — it sidesteps the argument-tab problem entirely. The level-aware `getArgumentCompletions` in `command.ts` is correct in principle (subcommand level → subcommands; model-id level → models) but the popup may not appear reliably in pi for chained arguments. **The no-args interactive flow is the fix** — don't try to make multi-level inline tab completion work.

## 6. What's working (as of last commit `bc12979`)

- **Inline annotation tag in `/model`**: the `  —  note` (auto-truncated to 40 chars + `…`) appears on every annotated row, and a detail pane (separator + bold model name + full note) appears under the list for the highlighted model. ANSI-strip regex fix is in place.
- **Footer widget for the active model**: `pi.on("model_select", ...)` sets `ctx.ui.setWidget("model-annotations", [key, note])` whenever the model changes (and clears it when the new model has no note).
- **Annotation storage**: `~/.pi/agent/model-annotations.json`, keyed by `model.id` (the id token shown in `/model` rows). Loaded/saved corruption-safely. `saveAnnotations` sorts keys for stable diffs.
- **Command-name tab completion**: tab-completing `/model-anno` → `model-annotations` works (level 0). The auto-inserted space + no-arg interactive flow is the intended UX.
- **`/model-annotations` (no args) → subcommand picker**: the 4-option `ctx.ui.select` (`list` / `get` / `set` / `rm`) appears. `list` opens a proper `openListView` TUI overlay (the old multi-line `ctx.ui.notify` was invisible).
- **Extension loads cleanly** in the installed clone (verified with `pi -p "ignore"`, exit 0).

## 7. Known issues (NOT fixed — to be addressed in the next session)

The user explicitly asked to stop coding at this point. The following are real, reproducible bugs. All three likely share a root cause in the focus / key-dispatch wiring of `ctx.ui.custom`.

### 7.1 `list` view TUI is read-only and `Esc` does nothing
- `src/picker.ts` `ListViewComponent.handleInput` claims to close on `escape`/`return`/`enter`/`kpenter`/`ctrl+c`/`q`. The user reports `Esc` did nothing and the list is not editable.
- **Intended behavior**: `list` should show annotations as a navigable, editable list — `↑/↓` to move, `Enter` to edit the highlighted entry (open a `ctx.ui.input` pre-filled with the current note, then save), `Esc` to close. This makes `list` a one-stop shop: see all notes, jump to one, edit it.
- **Suspected cause**: the `ctx.ui.custom` overlay may not be receiving key focus (the editor may still be capturing keys), or the key name `data` in `handleInput` doesn't match what pi-tui sends. Debug by logging what `data` arrives in `handleInput` to confirm keys are delivered at all.

### 7.2 `get` / `set` / `rm` picker freezes pi (no input, can't escape)
- `src/picker.ts` `ModelPickerComponent.handleInput` handles printable chars, `backspace`, `up`, `down`, `return`/`enter`/`kpenter`, `escape`/`ctrl+c`. The user reports: the picker shows the model list (rendering works — that fix is in), but then **typing / arrow keys / Esc do nothing** — pi is completely unresponsive and must be killed externally.
- **Suspected cause**: same as 7.1 — `ctx.ui.custom` may not be giving the factory's component keyboard focus, or keys are being swallowed by the underlying editor. The render fix made the picker display correctly; the interaction layer is the remaining gap. Since the picker shows the list, `Container` + `Text` + `Spacer` from the dynamic host import are correct.
- **Debug path**: verify the component receives focus (`ctx.ui.custom` doc says "Show a custom component with keyboard focus"). Inspect whether `handleInput` is ever called. If not, the fix is a focus / key-dispatch wiring issue. Possible workarounds: (a) implement the component as `Focusable` and request focus explicitly, (b) drive the picker externally via `pi.registerShortcut`, or (c) rebuild the picker using pi's existing `SelectList` component (from pi-tui) which may have working focus.

### 7.3 `rm` shows ALL models, not only annotated ones
- The current `runInteractiveFlow` for `rm` (and `get`) calls `openModelPicker(ctx)` which lists all ~350 available models. The user wants `rm` and `get` to show **only models that already have an annotation** (so you can pick which to remove, or retrieve an existing note).
- **Intended fix**: in `runInteractiveFlow`, for `get` and `rm`, build a separate items list from the annotations map (keys = annotated model ids; display = id + the note as a hint), and use a dedicated `openAnnotatedModelPicker(ctx, load)` — or extend `openModelPicker` to take a custom items list. For `set` (adding a new note), the full model list is still right.

## 8. Bypassed / deferred (with rationale)

- **Multi-level argument tab completion** (subcommand + model id in one `getArgumentCompletions`): the level-aware code is correct, but pi's autocomplete state machine is unreliable for chained arguments. The no-args interactive flow bypasses it. The level-aware code stays in `command.ts` for the cases that *do* work. **Don't try to fix this** — it's a pi design constraint.
- **Full TUI note editor** (multi-line textarea, word wrap, etc.): deferred per earlier "one thing at a time" guidance. `set` uses `ctx.ui.input` (single-line prompt). If a richer note editor is wanted later, the picker pattern can be extended.

## 9. Future work / open questions (intent for the next session)

Rough priority order:

1. **Fix the picker interaction** (issue 7.2) — the most blocking. Debug focus / key delivery for `ctx.ui.custom`. Likely requires either a pi-tui focus fix or a workaround (Focusable + explicit focus, or driving via `pi.registerShortcut`, or using pi-tui's `SelectList`).
2. **Make `list` editable + fix Esc** (issue 7.1) — `ListViewComponent` should support `↑/↓` navigation, `Enter` to edit (open `ctx.ui.input` prefilled with the note, then save), `Esc` to close. Likely depends on (1).
3. **Scoped `get` / `rm` pickers** (issue 7.3) — show only annotated models. Add `openAnnotatedModelPicker(ctx, load)` that reads the annotations map and shows those models + their notes as hints.
4. **Polish**: `Esc` / `Ctrl+C` consistency across both TUIs; ensure the picker and the list view can be aborted cleanly without leaving residual UI state.
5. **Tests**: there is no test suite. A small unit test for `appendAnnotations` (inline regex + ANSI strip) and for the level-aware `getArgumentCompletions` token parser would catch regressions cheaply. The jiti + real-host harness from earlier was fragile; transpile TS and unit-test pure functions without jiti.
6. **Documentation**: `README.md` and `DEV.md` were written early and don't reflect the current interactive-flow design or the gotchas in §5. Update them (especially the "no `dependencies`" + host-dynamic-import pattern, and the modelRegistry factory bug) for future contributors.

## 10. Build / install / test cheatsheet

```bash
# Workspace is the source of truth.
cd /home/johan/srv/syncthing/projects/pi-model-annotation

# After edits, on the `live` branch:
git add -A
git commit -m "..."
git push origin live:main       # publishes to main

# Installed clone (where pi actually loads from):
#   /home/johan/.pi/agent/git/github.com/ekenberg/pi-model-annotation/
# Sync it with the workspace (or re-clone via `pi update --extensions`):
cp src/*.ts /home/johan/.pi/agent/git/github.com/ekenberg/pi-model-annotation/src/

# Quick load check (no API key needed, just checks the extension parses + loads):
PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 pi -p "ignore"

# Interactive test in a real TUI session: restart pi, then `/model-annotations`.
```

---

*End of handoff. Next session: read §5 (gotchas), §7 (known issues), and §9 (future work) before changing anything.*
