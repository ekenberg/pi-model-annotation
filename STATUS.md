# pi-model-annotation — Status & Handoff

*Session: 2026-07-11 (4th). Built with AI assistance (transparently AI-generated; see README).*

This is the handoff document for the next session. Read §5 (gotchas) and §7 before changing anything.

---

## 0. CURRENT STATE (2026-07-11 — unified editor + scoped sorting)

`/model-annotations` (no args, no subcommands, no tab completion) opens ONE
interactive component via `ctx.ui.custom`. Designed by user, fleshed out by
planner+reviewer subagents, implemented via worker↔reviewer loops.

### UX — single fuzzy-filtered list, three inline modes

**List mode** — sorts ANNOTATED > SCOPED > REST (alphabetical within tier):
- `★` marker + `—  note` hint for annotated (registry models show name as
  label; orphans show id).
- `◆` marker for scoped-but-not-annotated (read from `enabledModels` in
  settings.json — see §5.7). Annotated+scoped shows only `★` (annotated wins).
- Unmarked for the rest.
- Legend line `★ annotated  ◆ scoped` under the title.
- Fuzzy filter across id + name + note (via embedded pi-tui `Input`).
- Keys: ↑/↓ navigate (wrap) · Enter → edit · Ctrl+D → confirm · Esc → exit ·
  type to filter.

**Edit mode** — embedded pi-tui `Input` (NOT `ctx.ui.input` — that CANNOT
prefill; `ExtensionInputComponent` ignores its placeholder arg, so
`editInput.setValue(existingNote)` is the only way to prefill). Cursor placed
at end of existing note on entry.
- Enter = save (non-empty) → refreshed list · Esc = cancel → list ·
  Ctrl+D → confirm · **Empty+Enter = delete** (if text is empty after trim,
  there's nothing to lose — re-opening and retyping is trivial; idempotent
  if no annotation exists).

**Confirm mode (inline, NOT `ctx.ui.confirm`)** — `ctx.ui.confirm` DESTROYS
the `ctx.ui.custom` component (replaces editorContainer, restores editor on
resolve → orphans our component, promise hangs forever). So delete confirm is
a third inline mode: y/Y/Enter = delete, n/N/Esc = cancel → previous mode
(preserves editInput state if cancelled from edit). `handleInput` is SYNC.

**Esc semantics:** Esc in edit/confirm = cancel→list; Esc in list = exit.
On return to list: rebuild from `load()` + `modelRegistry.getAvailable()`,
preserve search filter + selection position.

### What's working (as of HEAD)
- `/model` inline `  —  note` tag (auto-truncated 40 chars + `…`) on every
  annotated row. ANSI-strip regex in place (§5.3).
- `/model` detail pane for highlighted annotated model: separator, `Annotations`
  label, full note. (Was: separator + bold model name + [provider] + note;
  simplified per user request.)
- `/model-annotations` unified editor: list/edit/confirm modes, fuzzy filter,
  scoped sorting + markers, legend. Load check exit 0.
- Annotation storage: `~/.pi/agent/model-annotations.json`, keyed by
  `model.id`. Corruption-safe load, sorted-keys save for stable diffs.

### What was deleted (vs. the v1 subcommand architecture)
- All subcommands (`list`/`get`/`set`/`rm`), command-line parsing, tab
  completion, `getArgumentCompletions`, `doList`/`doGet`/`doSet`/`doRm`,
  `runInteractiveFlow`, `runCommandLine`, `SUBS`, `MODEL_ARG_SUBS`,
  `cachedModels`, `getModelCompletions`.
- `openModelPicker`, `openAnnotatedModelPicker`, `openListView`, `PickerItem`
  (replaced by `openAnnotationEditor` + `AnnotationEditorComponent`).
- **Footer widget removed** (was `pi.on("model_select")` → `ctx.ui.setWidget`).
  It rendered the model id + note as two lines above the editor after picking
  a model in `/model` — not useful. The `/model` inline tags + detail pane are
  the only display surfaces now.

### Design rationale
- **No tabs:** reviewer argued tabs are over-engineered for a 5-20 annotated
  set vs 350+ in all. `/model`'s scoped/all analogy doesn't hold (there both
  sets are large). Single list with annotated sorted to top + `★` = the "show
  me my notes" view for free, ~30-40% less code.
- **Empty+Enter = delete:** user's call — if the text is already empty after
  trim, there's nothing to lose. Ctrl+D remains as explicit delete-with-confirm
  for when you want to delete without clearing the text first.
- **Scoped via settings.json:** the extension `ctx` does NOT expose
  `session.scopedModels` or `settingsManager`. Workaround: read `enabledModels`
  patterns from settings.json and glob-match against `getAvailable()` (§5.7).
  Limitation: captures persistent Ctrl+P scope, NOT session-level
  `/scoped-models` runtime changes (those only live on the session object).

### Earlier context (still relevant): the key-handling fix
The picker once froze because `handleInput(data)` compared RAW terminal escape
sequences against PARSED key-name strings (`"escape"`, `"up"`). The TUI
delivers raw bytes to `focusedComponent.handleInput` (tui.js:609). Fix: use
`getKeybindings().matches()` / `matchesKey()`. The unified editor uses these
correctly; the only raw `data ===` comparisons are printable chars (y/n) in
the confirm sub-mode, which is correct.

---

## 1. What this is

A [pi](https://github.com/badlogic/pi) extension that lets you attach a short
*"why is this model here / usecase"* note to any model, and shows those notes
inside pi:

1. **In the built-in `/model` selector** — an inline `  —  note` tag on every
   annotated row, and a detail pane (separator + `Annotations` label + full
   note) under the list for the currently highlighted model.
2. **Via `/model-annotations`** — a unified interactive editor (single
   fuzzy-filtered list with inline edit + confirm modes) to create, edit, and
   delete annotations.

The goal: a human with 350+ available models can remember *why* a particular
model is in their scoped set (e.g. "cheap toolcalling", "image classification")
without consulting an external note.

## 2. Intended user experience

```
$ /model-annotations        (no arguments — just press Enter)
```

1. A single fuzzy-filtered list opens. Annotated models sort to top with `★`
   + `—  note` hint; scoped-but-not-annotated models sort next with `◆`; the
   rest follow unmarked. A legend (`★ annotated  ◆ scoped`) is shown.
2. Type to filter (fuzzy across id + name + note). ↑/↓ to navigate.
3. Enter on a model → inline edit view (prefilled with existing note, cursor
   at end). Edit the note, Enter to save. Empty+Enter = delete. Esc = cancel.
4. Ctrl+D → inline confirm prompt (y/n) to delete the annotation.
5. After save/delete, return to the (refreshed) list. Esc in list = exit.

The annotation JSON file (`~/.pi/agent/model-annotations.json`) is the
scriptable surface for power-user automation (`jq`, etc.) — there are no
subcommands or command-line forms.

## 3. Repo layout

```
pi-model-annotation/
├── AGENTS.md           lean repo orientation (conventions, verified constraint, hard rules)
├── DEV.md              design notes (mechanism, branches, edit loop)
├── README.md           install + usage (user-facing)
├── STATUS.md           this file (handoff / current state)
├── PLAN-sort-filter.md plan for the open sorting-while-filtering issue (issue 3)
├── package.json        pi package manifest (pi.extensions: ["./index.ts"])
├── index.ts            extension factory: resolves host modules, installs the
│                       /model monkeypatch, registers the command
└── src/
    ├── storage.ts      loadAnnotations / saveAnnotations on ~/.pi/agent/model-annotations.json
    ├── patch.ts        installModelAnnotationsPatch — runtime-monkeypatches
    │                   ModelSelectorComponent.updateList to append inline tag + detail pane
    ├── picker.ts       openAnnotationEditor + AnnotationEditorComponent (unified editor:
    │                   list/edit/confirm modes, fuzzy filter, scoped sorting + markers)
    └── command.ts      /model-annotations command registration (thin: no args, no completions)
```

Workspace = source of truth. Installed globally via
`pi install git:git@github.com:ekenberg/pi-model-annotation@live`. Branches:
`main` (canonical) and `live` (install branch). Edit on `live`; push to `live`
(`git push origin live`). To publish to `main`: `git push origin live:main`.

## 4. Verified constraint (why this approach is non-trivial)

pi exposes **no official extension hook** into the `/model` list rendering, and
`Model` has no `notes` field. The proven technique (used by the installed
`pi-model-selector-x` package) is to **runtime-monkeypatch**
`ModelSelectorComponent.prototype.updateList`: at extension load, dynamically
import pi's own bundled `modes/interactive/components/model-selector.js`
(resolved from `dirname(realpathSync(process.argv[1]))`), wrap `updateList` so
it calls the original and then appends our annotation, and unpatch on
`session_shutdown`. The patch chains safely with other patches (idempotent
uninstall-first). No edits to pi's dist files on disk — survives `pi update`.

## 5. Key implementation gotchas (learned the hard way — read before changing)

### 5.1 `pi.modelRegistry` is undefined in the factory
The TypeScript types promise `ExtensionAPI.modelRegistry: ModelRegistry`, but
the runtime `api` object that pi's `createExtensionAPI` hands to the factory
does **not** include `modelRegistry`. It's only available on the
command-handler `ctx` (and event contexts), via a getter in the runner
(runner.js `createCommandContext`). Always read the model list from
`ctx.modelRegistry.getAvailable()` in the command handler / component, never
from `pi.modelRegistry` in the factory.

### 5.2 Never override `render()` on a pi-tui Component
`Container.render(width)` iterates `this.children` and concatenates each
child's `render(width)` output. If you override `render` and return
`undefined`, the TUI crashes with `TypeError: childLines is not iterable`.
**Do not override `render`.** Give the populate logic a different name (e.g.
`populateList()` / `buildListChildren()`), call it from the constructor and on
each input change, and let the inherited `Container.render` do the drawing.

### 5.3 ANSI codes in `/model` row text
pi's `ModelSelectorComponent` builds each row as
`` `${theme.fg("accent", modelText)} ${providerBadge}${checkmark}` `` — so the
raw `child.text` contains ANSI SGR codes wrapping the id AND the provider
badge, with the `[` of the badge preceded by an escape, not a space. Any regex
like `/\s+\[([^\]]+)\]/` that expects `space + [provider]` will silently never
match. **Always strip ANSI SGR codes** (`s.replace(/\x1b\[[0-9;]*m/g, "")`)
from the row text before matching. Use the original (styled) text for
`setText` so the row's existing colors are preserved.

### 5.4 `Container` class scope at module load
If you use `extends Container` at the top level of a module, the class
declaration runs at module load time — but if `Container` is only available
after an `await import(...)` inside a function, the top-level `extends` fails
with `Container is not defined`. Define the class **inside** the function
(after the dynamic import) so the base class is in scope. `AnnotationEditorComponent`
is defined inside `openAnnotationEditor` for this reason.

### 5.5 pi-tui components are imported dynamically from the host
The extension has **no `dependencies`** in `package.json` (pi git-packages
install with `--omit=dev`, and adding bare specifier deps can pull in 140+ host
transitive packages). Instead, every `pi-tui` import is done **dynamically at
runtime** from the host's own `node_modules`:

```ts
import(pathToFileURL(resolve(
  dirname(realpathSync(process.argv[1])),
  "../node_modules/@earendil-works/pi-tui/dist/index.js"
)).href)
```

This guarantees the SAME copy of `pi-tui` the host uses, with no version drift
and no install-time bloat. `picker.ts`'s `loadTui()` does this for
`Container`/`Text`/`Spacer`/`Input`/`fuzzyFilter`/`getKeybindings`/`matchesKey`/`Key`.

### 5.6 `ctx.ui.input` CANNOT prefill — use embedded `Input`
`ctx.ui.input(title, placeholder)` routes to `ExtensionInputComponent`
(extension-input.js) which takes `_placeholder` and **ignores it** — the Input
is created fresh with no `setValue()`. So prefilling an existing note via
`ctx.ui.input` silently never works. The unified editor embeds a pi-tui
`Input` directly and calls `editInput.setValue(existingNote)` to prefill.
This also means `ctx.ui.input` cannot be used as an edit modal from inside a
`ctx.ui.custom` component (it would close the custom component + lose prefill).

### 5.7 Scoped models are NOT on `ctx` — read settings.json
The extension `ctx` (runner.js `createCommandContext`) exposes: `ui`, `hasUI`,
`cwd`, `sessionManager`, `modelRegistry`, `model`, `isIdle`, `signal`, etc.
It does **NOT** expose `session.scopedModels` or `settingsManager` (those live
on the interactive-mode instance, not on ctx). To determine which models are
"scoped" (for the ◆ marker + sort tier), `picker.ts` reads the `enabledModels`
patterns directly from settings.json:
- Global: `<agentDir>/settings.json` where agentDir = `PI_CODING_AGENT_DIR/agent`
  or `~/.pi/agent`.
- Project: `<cwd>/.pi/settings.json` (overrides global for `enabledModels`).
Then glob-matches (`*`→`.*`, `?`→`.`, anchored, case-insensitive) against
each model's `id`, `name`, and `provider/id`. Patterns may have a
`:thinkingLevel` suffix (e.g. `claude-*:high`) — stripped before matching.
**Limitation:** this captures the persistent Ctrl+P scope (from settings),
NOT session-level runtime changes made via `/scoped-models` (those only live
on the session object, which ctx doesn't expose).

### 5.8 `ctx.ui.confirm` destroys `ctx.ui.custom` components
`ctx.ui.confirm` routes to `showExtensionSelector` which does
`editorContainer.clear()` + `addChild(extensionSelector)` — replacing our
component. On resolve, `hideExtensionSelector` restores the editor (NOT our
component), orphaning it; the `ctx.ui.custom` promise never resolves → command
handler hangs forever. **Never call `ctx.ui.confirm` (or `ctx.ui.input`,
`ctx.ui.select`) from inside a `ctx.ui.custom` component.** Implement confirm
as an inline sub-mode within the component (the unified editor's `confirm`
mode does this: y/n/Enter/Esc handled directly, no ctx.ui.* calls).

### 5.9 `handleInput` must be sync; TUI doesn't await it
`tui.js` calls `focusedComponent.handleInput(data); this.requestRender()` —
no `await`. An `async handleInput` returns a Promise immediately; the TUI fires
`requestRender` before any `await` inside resolves. This was a problem when
the editor used `await ctx.ui.confirm` (the confirm replaced the DOM mid-render).
The fix (inline confirm, §5.8) also made `handleInput` sync, which is strictly
better. Keep `handleInput` sync.

## 6. Key-handling: raw bytes vs. parsed key names (the freeze bug)
The TUI delivers RAW terminal escape sequences to `handleInput(data)` (e.g.
`"\x1b"` for Esc, `"\x1b[A"` for Up, `"\r"` for Enter, `"\x7f"` for Backspace)
— NOT parsed key names like `"escape"`/`"up"`/`"return"`. Comparing
`data === "up"` never matches → the picker appeared hung. **Always use
`getKeybindings().matches(data, "tui.select.up")` or
`matchesKey(data, Key.up)`** — what every working pi component uses
(`ModelSelectorComponent`, `SelectList`, `preset.ts` example). The only raw
`data ===` comparisons allowed are printable chars (e.g. y/n in the confirm
sub-mode), because those arrive as single-byte data equal to the char.

## 7. Resolved issues (historical)
All v1 picker bugs shared the same root cause (§6: raw-vs-parsed key
comparison) and are fixed. v2 redesign (unified editor) replaced the entire
subcommand architecture; the worker↔reviewer loop found and fixed a critical
blocker (`ctx.ui.confirm` destroys `ctx.ui.custom`, §5.8) before commit.
Footer widget was added in v1, found to be not useful (rendered model id +
note as two lines above the editor after `/model` selection), and removed.

## 8. Open issue: sort breaks when filtering (PLAN-sort-filter.md)
The ANNOTATED > SCOPED > REST sort works for the default (unfiltered) list,
but `fuzzyFilter` reorders results by fuzzy match score, discarding the
pre-sort. See `PLAN-sort-filter.md` for the diagnosis and fix plan.

## 9. Future work
1. **Sort-while-filtering** (open — see `PLAN-sort-filter.md`).
2. **Tests:** no suite. A unit test for `appendAnnotations` (inline regex +
   ANSI strip) and the scoped-glob matching (`globToRegex` +
   `computeScopedIds`) would catch regressions cheaply. Transpile TS and
   unit-test pure functions without jiti.
3. **Multi-line notes:** `Input` is single-line (strips newlines from paste).
   Fine for short notes. If multi-line is ever wanted, swap `Input` for
   `Editor` (~1881 lines, much bigger change) or use `ctx.ui.editor` modal
   (has the same prefill problem as `ctx.ui.input`, §5.6 — would need verifying).

## 10. Build / install / test cheatsheet

```bash
# Workspace is the source of truth.
cd /home/johan/srv/syncthing/projects/pi-model-annotation

# After edits, on the `live` branch:
git add -A
git commit -m "..."
git push origin live          # updates the install branch
# To also publish to main (canonical):
git push origin live:main

# Installed clone (where pi actually loads from):
#   /home/johan/.pi/agent/git/github.com/ekenberg/pi-model-annotation/
# Sync it with the workspace (or re-clone via `pi update --extensions`):
cp src/*.ts /home/johan/.pi/agent/git/github.com/ekenberg/pi-model-annotation/src/
cp index.ts /home/johan/.pi/agent/git/github.com/ekenberg/pi-model-annotation/index.ts

# Quick load check (no API key needed, just checks the extension parses + loads):
PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 pi -p "ignore"

# Interactive test in a real TUI session: restart pi (or /reload), then `/model-annotations`.
```

---

*End of handoff. Next session: read §5 (gotchas), §6 (key handling), and §8 (open issue) before changing anything.*
