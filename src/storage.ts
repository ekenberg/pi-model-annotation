import { existsSync, readFileSync, writeFileSync } from "node:fs";

export type AnnotationMap = Record<string, string>;

/** Read annotations; never throws (corrupt file -> empty map). */
export function loadAnnotations(path: string): AnnotationMap {
	try {
		if (!existsSync(path)) return {};
		const raw = readFileSync(path, "utf8").trim();
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			const out: AnnotationMap = {};
			for (const [k, v] of Object.entries(parsed)) {
				if (typeof k === "string" && typeof v === "string") out[k] = v;
			}
			return out;
		}
	} catch {
		// corrupt JSON: behave as empty so /model never breaks
	}
	return {};
}

/** Write annotations sorted by key for stable, diff-friendly files. */
export function saveAnnotations(path: string, map: AnnotationMap): void {
	const sorted: AnnotationMap = {};
	for (const k of Object.keys(map).sort()) sorted[k] = map[k];
	writeFileSync(path, JSON.stringify(sorted, null, 2) + "\n", "utf8");
}
