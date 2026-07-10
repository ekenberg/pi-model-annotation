// pi-model-annotation
// Shows your "why is this model here" notes inside the built-in /model
// selector, and provides /model-annotations to edit them.
//
// Display (per the chosen design):
//   - INLINE tag next to every scoped model that has a note
//   - a DETAIL pane under the list for the highlighted model
//
// Storage: ~/.pi/agent/model-annotations.json, keyed by "provider/id".
//
// Technique: runtime-monkeypatch ModelSelectorComponent.updateList by
// dynamically importing pi's OWN bundled module (resolved from the process
// entry). No edits to pi's dist files -> survives `pi update`.

import { realpathSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { homedir } from "node:os";

import { loadAnnotations, saveAnnotations } from "./src/storage.js";
import { installModelAnnotationsPatch } from "./src/patch.js";
import { registerModelAnnotationsCommand } from "./src/command.js";

function getHostDistDir(): string {
	return dirname(realpathSync(process.argv[1]));
}
function hostUrl(relativePath: string): string {
	return pathToFileURL(resolve(getHostDistDir(), relativePath)).href;
}
function annotationsPath(): string {
	const override = process.env.PI_CODING_AGENT_DIR;
	const base = override ? join(override, "agent") : join(homedir(), ".pi", "agent");
	return join(base, "model-annotations.json");
}

export default async function (pi: any) {
	// Resolve host modules via the SAME copies pi uses (no version skew).
	const [{ ModelSelectorComponent }] = await Promise.all([
		import(hostUrl("modes/interactive/components/model-selector.js")),
	]);
	const themeMod: any = await import(hostUrl("modes/interactive/theme/theme.js"));
	const theme = themeMod.theme;
	const tuiMod: any = await import(hostUrl("../node_modules/@earendil-works/pi-tui/dist/index.js"));
	const { Text, Spacer } = tuiMod;

	const path = annotationsPath();

	// Live-read on every render so edits appear without /reload.
	// Key = model.id (exactly the id token shown in /model rows).
	const getNote = (key: string): string | undefined => {
		return loadAnnotations(path)[key];
	};

	const unpatch = installModelAnnotationsPatch(ModelSelectorComponent, theme, Text, Spacer, getNote);
	pi.on("session_shutdown", () => {
		try {
			unpatch();
		} catch {
			/* ignore */
		}
	});

	registerModelAnnotationsCommand(
		pi,
		path,
		() => loadAnnotations(path),
		(m) => saveAnnotations(path, m),
	);

	// Bonus: persistent reminder of WHY the active model is here.
	pi.on("model_select", async (event: any, ctx: any) => {
		if (!ctx.hasUI) return;
		const m = event?.model;
		if (!m) return;
		const note = loadAnnotations(path)[m.id];
		if (note) ctx.ui.setWidget("model-annotations", [m.id, note]);
		else ctx.ui.setWidget("model-annotations", undefined);
	});
}
