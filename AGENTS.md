# AGENTS.md

pi-model-annotation — a pi extension that lets you attach short "why is this
model here" notes to scoped models and shows them in the built-in `/model`
selector and as a footer widget for the active model.

## Repo layout
- `index.ts` — extension factory (resolves host modules, installs patch, registers command).
- `src/storage.ts` — annotations JSON (load/save, corruption-safe).
- `src/patch.ts` — `installModelAnnotationsPatch` (runtime patch of `ModelSelectorComponent`).
- `src/command.ts` — `/model-annotations` editor + tab completion.
- `package.json` — pi package manifest.
- `README.md` — install + usage.
- `DEV.md` — design notes, branches, edit loop.

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
- Inline row tags are auto-truncated to 40 chars; the detail pane and footer
  widget show the full note.
