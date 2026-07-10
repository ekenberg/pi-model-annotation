# pi-model-annotation

> **Transparency:** This extension was generated with AI assistance.
> See [`DEV.md`](DEV.md) for how it works and how to modify it.

A [pi](https://github.com/badlogic/pi) extension that lets you annotate
models with short notes explaining why they're in your scoped set, and
shows those notes in the built-in `/model` selector and as a footer widget
for the active model.

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

```bash
# Add or update a note
/model-annotations set openrouter/anthropic/claude-sonnet-4 "Cheap, good toolcalling"

/model-annotations list
/model-annotations get openrouter/anthropic/claude-sonnet-4
/model-annotations rm  openrouter/anthropic/claude-sonnet-4
```

In `/model`, annotated models show an inline tag next to their id; the
highlighted model additionally shows a detail pane with the full note.
The active model's note is also shown as a footer widget whenever you
switch models.

Tab completion is available for both the subcommand and the model id
(via `pi.modelRegistry`).

## Requirements

- pi with extension support.
- The `~/.pi/agent/model-annotations.json` file is created on first edit.

## How it works (brief)

The built-in `/model` selector has no extension hook into its list
rendering. This extension runtime-monkeypatches
`ModelSelectorComponent.updateList` (importing pi's own bundled module at
runtime) to append an inline tag per annotated row and a detail pane for
the highlighted model. It unpatches on `session_shutdown`, so it survives
`pi update`. See [DEV.md](DEV.md) for the full design.
