# pi-model-annotation

> **Transparency:** This extension was generated with AI assistance.
> See [`DEV.md`](DEV.md) for how it works and how to modify it.

A [pi](https://github.com/badlogic/pi) extension that lets you annotate
models with short notes explaining why they're in your scoped set, and shows
those notes in the built-in `/model` selector.

## Install

This repo is a pi package. Install it with pi (no manual symlinks needed):

```bash
# SSH (reliable on the owner's machine)
pi install git:git@github.com:ekenberg/pi-model-annotation@live

# HTTPS (works for the public repo on machines with git credentials)
pi install git:github.com/ekenberg/pi-model-annotation@live
```

Then reload extensions in your running session:

```
/reload
```

Update later:

```bash
pi update --extensions
```

## Usage

```
/model-annotations
```

Opens an interactive editor. The list is fuzzy-filtered and sorted into three
tiers: annotated models (`★` + note hint) first, then scoped-but-not-
annotated models (`◆`), then the rest. A legend (`★ annotated  ◆ scoped`) is
shown under the title.

- **↑/↓** navigate · **type to filter** (fuzzy on id + name + note)
- **Enter** edit the highlighted model's annotation (prefilled; cursor at end)
- **Ctrl+D** delete the highlighted model's annotation (confirms first)
- **Esc** cancel edit/confirm → back to list; Esc in list exits
- In edit: **Enter** saves · **Esc** cancels · **Ctrl+D** deletes ·
  **empty + Enter** deletes (if the note is cleared, there's nothing to lose)

The annotation JSON file (`~/.pi/agent/model-annotations.json`) is the
scriptable surface for power-user automation (`jq`, etc.) — there are no
subcommands or command-line forms.

### In `/model`

Annotated models show an inline `  —  note` tag next to their id (auto-
truncated to 40 chars). The highlighted annotated model additionally shows a
detail pane with the separator, an `Annotations` label, and the full note.

## Requirements

- pi with extension support.
- The `~/.pi/agent/model-annotations.json` file is created on first edit.

## How it works (brief)

The built-in `/model` selector has no extension hook into its list rendering.
This extension runtime-monkeypatches `ModelSelectorComponent.updateList`
(importing pi's own bundled module at runtime) to append an inline tag per
annotated row and a detail pane for the highlighted model. It unpatches on
`session_shutdown`, so it survives `pi update`. See [DEV.md](DEV.md) for the
full design.
