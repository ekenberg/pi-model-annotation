# DEV.md

## Design

**Problem.** pi's `/model` selector renders rows as `id [provider] ✓` with
no extension hook. We need to show per-model notes without forking the
selector.

**Mechanism (verified).** Mirror the technique used by `pi-model-selector-x`:
at extension load, dynamically import pi's own bundled
`modes/interactive/components/model-selector.js` (resolved from
`dirname(realpathSync(process.argv[1]))`), then wrap
`ModelSelectorComponent.prototype.updateList` so it calls the original and
then appends our annotation. Unpatch on `session_shutdown`.

**Stacking-proof teardown.** `pi-model-selector-x` wraps the same `updateList`
and pi re-inits extensions every session/reload cycle. Both patchers using an
outermost-only unpatch caused wrappers to orphan and re-stack (one duplicate
detail card per `/reload`). So `src/patch.ts` captures pi's pristine
`updateList` once and, on teardown, resets the whole prototype to pristine
(full chain unwind) instead of restoring only its own layer. Install stays
politely chained so we still sit on top of selector-x's card. Pristine capture
needs a clean process — do one full `pi` restart after deploying, not just
`/reload`.

**Display in `/model`.** Two parts, both inside the same patched `updateList`:
1. *Inline tag* on every annotated row (the row's `id` token is matched
   against the annotation map; the tag is auto-truncated to 40 chars so long
   notes don't break the row layout).
2. *Detail pane* under the list for the currently highlighted model
   (separator, `Annotations` label, full note). The model name + provider line
   was removed — the row above already shows them.

**Storage.** `~/.pi/agent/model-annotations.json`, keyed by `model.id`
(the id token shown in `/model` rows — consistent across the row regex
and `event.model.id`).

**Editor.** `/model-annotations` (no arguments) opens a single interactive
TUI component via `ctx.ui.custom`. A fuzzy-filtered list shows annotated
models sorted to the top (★ marker + `—  note` hint), then scoped-but-not-
annotated models (◆ marker), then the rest. A legend (`★ annotated  ◆ scoped`)
appears under the title. Enter opens an inline `Input` to edit/create the note
(prefilled if one exists; cursor at end). Ctrl+D triggers an inline confirm
prompt (y/n) to delete the annotation — `ctx.ui.confirm` cannot be used
because it destroys the custom component (see STATUS.md §5.8). Esc cancels
edit/confirm and returns to the list; Esc in the list exits. Empty+Enter in
edit = delete (if the text is empty after trim, there's nothing to lose).
The annotation JSON file is the scriptable surface for power-user automation
(`jq`, etc.) — there are no subcommands or command-line forms.

**Scoped models.** The extension `ctx` does not expose `session.scopedModels`
or `settingsManager`, so scoped models are determined by reading the
`enabledModels` patterns from settings.json (global + project override) and
glob-matching against `ctx.modelRegistry.getAvailable()`. This captures the
persistent Ctrl+P scope, not session-level `/scoped-models` runtime changes.
See STATUS.md §5.7.

**Footer widget.** Removed. An earlier version set a footer widget on
`model_select` showing `[model.id, note]`, but it rendered as two lines above
the editor after picking a model in `/model` — not useful. The `/model` inline
tags + detail pane are the only display surfaces.

## Branches
- `main` — canonical, receives pushes via `git push origin live:main`.
- `live` — the branch users install with `pi install ...@live`.

## Edit loop
1. Edit files on `live`.
2. `pi update --extensions` (or `/reload` for hot-reload) to pick up changes.
3. `git add` + `git commit` on `live`.
4. `git push origin live` to update the install branch; `git push origin live:main`
   to publish to `main`.
