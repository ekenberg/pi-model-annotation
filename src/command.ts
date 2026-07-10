// `/model-annotations` — opens the unified annotation editor. No subcommands,
// no command-line forms, no tab completion. The annotation JSON file
// (~/.pi/agent/model-annotations.json) is the scriptable surface; this command
// is purely interactive.
//
// IMPORTANT wiring note: the factory-time `pi` (ExtensionAPI returned by
// `createExtensionAPI` in pi's loader) does NOT expose `modelRegistry` at runtime
// (the types promise it, but the runtime api object omits it). The
// ModelRegistry is only available on the command-handler `ctx` and on event
// contexts — openAnnotationEditor reads it from `ctx` internally.

import { openAnnotationEditor } from "./picker.js";

export function registerModelAnnotationsCommand(
	pi: any,
	_path: string,
	load: () => Record<string, string>,
	save: (m: Record<string, string>) => void,
): void {
	pi.registerCommand("model-annotations", {
		description: "Manage model annotations shown in /model.",
		handler: async (_args: string, ctx: any) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("Run /model-annotations in the interactive session.", "info");
				return;
			}
			await openAnnotationEditor(ctx, load, save);
		},
	});
}
