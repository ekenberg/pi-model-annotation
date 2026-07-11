# AGENTS.md

pi-model-annotation — a pi extension that lets you attach short "why is this
model here" notes to models and shows them in the built-in `/model` selector.

## Repo layout
- `index.ts` — extension factory (resolves host modules, installs patch, registers command).
- `src/storage.ts` — annotations JSON (load/save, corruption-safe).
- `src/patch.ts` — `installModelAnnotationsPatch` (runtime patch of `ModelSelectorComponent`).
- `src/picker.ts` — `openAnnotationEditor` + `AnnotationEditorComponent` (unified editor:
  list/edit/confirm modes, fuzzy filter, scoped sorting + ★/◆ markers).
- `src/command.ts` — `/model-annotations` command registration (thin: no args, no completions).
- `package.json` — pi package manifest.
- `README.md` — install + usage.
- `DEV.md` — design notes, branches, edit loop.
- `STATUS.md` — handoff / current state (read before changing anything).
- `PLAN-sort-filter.md` — plan for sorting-while-filtering (implemented; kept for context).

## Verified constraint
pi exposes **no official extension hook** into the `/model` list rendering,
and `Model` has no `notes` field. This extension works by
runtime-monkeypatching `ModelSelectorComponent.prototype.updateList` via
dynamic import of pi's own bundled module (the technique proven by
`pi-model-selector-x`).

## Conventions
- Install on the `live` branch; publish to `main` via `git push origin live:main`.
- Annotations stored in `~/.pi/agent/model-annotations.json` (one JSON map, key = `model.id`).
- Storage key = the `model.id` token shown in `/model` rows
  (e.g. `openrouter/anthropic/claude-sonnet-4`).

## Hard rules
- Do not edit pi's dist files. The patch resolves host modules at runtime.
- Inline row tags are auto-truncated to 40 chars; the detail pane shows the full note.
- Never call `ctx.ui.confirm` / `ctx.ui.input` / `ctx.ui.select` from inside a
  `ctx.ui.custom` component — they destroy the custom component's DOM and hang
  the promise. Use inline sub-modes instead. (See STATUS.md §5.8.)
- Never override `render(width)` on a pi-tui Container — let inherited render
  draw; only manage children via `clear()`/`addChild()` + a `populate*()` method.
  (See STATUS.md §5.2.)
