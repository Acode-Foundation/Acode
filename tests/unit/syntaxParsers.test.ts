// @vitest-environment happy-dom

import { parserFingerprint } from "@acode.app/canvas-view";
import { language } from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";
import { getMode } from "cm/modelist";
import { syntaxParsers } from "cm/syntaxParsers";
import { describe, expect, it, vi } from "vitest";
import "cm/supportedModes";

// The HTML family reads the auto-close-tags setting; it doesn't change parsers.
vi.mock("lib/settings", () => ({ default: { value: {} } }));

// Modes whose documents the canvas renderer's syntax worker should parse:
// for each, the worker must have a parser configured like the editor's,
// or those files are parsed on the main thread.
const WORKER_MODES = [
	"javascript",
	"jsx",
	"typescript",
	"tsx",
	"html",
	"xml",
	"php",
	"vue",
	"angular template",
	"markdown",
	"css",
	"less",
	"scss",
	"sass",
	"json",
	"python",
	"java",
	"c",
	"c++",
	"rust",
	"go",
	"yaml",
];

async function editorLanguage(mode: string) {
	const provider = getMode(mode)?.getExtension();
	expect(provider, mode).toBeTruthy();
	const extension = (await provider!()) as Extension;
	return EditorState.create({ extensions: extension }).facet(language);
}

describe("syntax worker parsers", () => {
	for (const mode of WORKER_MODES) {
		it(`match the editor's ${mode} parser`, async () => {
			const lang = await editorLanguage(mode);
			expect(lang, mode).toBeTruthy();
			const offered = (await syntaxParsers(lang!.name)).map(parserFingerprint);
			expect(offered).toContain(parserFingerprint(lang!.parser));
		});
	}

	it("leave out stream modes and SQL", async () => {
		expect(await syntaxParsers("sql")).toEqual([]);
		const shell = await editorLanguage("sh");
		expect(await syntaxParsers(shell!.name)).toEqual([]);
	});
});
