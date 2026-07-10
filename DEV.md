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

**Display.** Two parts, both inside the same patched `updateList`:
1. *Inline tag* on every annotated row (the row's `id` token is matched
   against the annotation map; the tag is auto-truncated to 40 chars so long
   notes don't break the row layout).
2. *Detail pane* under the list for the currently highlighted model
   (separator, bold name + provider, full note).

**Storage.** `~/.pi/agent/model-annotations.json`, keyed by `model.id`
(the id token shown in `/model` rows — consistent across the row regex
and `event.model.id`).

**Editor.** `/model-annotations` slash command
(`list | get | set | add | edit | rm | remove | delete <model-id> <note>`).
`set` with no note opens `ctx.ui.input` prefilled with the existing note.
Tab completion completes the subcommand and the model id from
`pi.modelRegistry.getAll()`.

**Footer widget.** `pi.on("model_select")` shows the active model's
annotation via `ctx.ui.setWidget` (cleared when none).

## Branches
- `main` — canonical, receives pushes via `git push origin live:main`.
- `live` — the branch users install with `pi install ...@live`.

## Edit loop
1. Edit files on `live`.
2. `pi update --extensions` (or `/reload` for hot-reload) to pick up changes.
3. `git add` + `git commit` on `live`.
4. `git push origin live:main` to publish to `main`.
