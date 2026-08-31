import type { Extension } from "@codemirror/state";
import { viewportPriorityParsing } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import searchMatchHighlighter from "./searchMatchHighlighter";

interface MainEditorExtensionOptions {
	emmetExtensions?: Extension[];
	baseExtensions?: Extension[];
	commandKeymapExtension?: Extension;
	themeExtension?: Extension;
	pointerCursorVisibilityExtension?: Extension;
	shiftClickSelectionExtension?: Extension;
	multiCursorSelectionExtension?: Extension;
	touchSelectionUpdateExtension?: Extension;
	quickToolsModifierInputExtension?: Extension;
	searchExtension?: Extension;
	readOnlyExtension?: Extension;
	optionExtensions?: Extension[];
}

function pushExtension(target: Extension[], extension?: Extension): void {
	if (extension == null) return;
	target.push(extension);
}

export const fixedHeightTheme = EditorView.theme({
	"&": { height: "100%" },
	".cm-scroller": {
		height: "100%",
		overflow: "auto",
	},
});

export const renderingPerformanceExtensions: Extension[] = [
	EditorView.viewportBuffer.of({ maxAhead: 4, settleDelay: 120 }),
	EditorView.controlledTouchScroll.of({ maxAhead: 4, settleDelay: 120 }),
	viewportPriorityParsing({ sliceMs: 4, approximate: "outer-language" }),
];

export function createMainEditorExtensions(
	options: MainEditorExtensionOptions = {},
): Extension[] {
	const extensions: Extension[] = [];

	if (options.emmetExtensions?.length) {
		extensions.push(...options.emmetExtensions);
	}
	if (options.baseExtensions?.length) {
		extensions.push(...options.baseExtensions);
	}

	pushExtension(extensions, options.commandKeymapExtension);
	pushExtension(extensions, options.themeExtension);
	extensions.push(fixedHeightTheme);
	extensions.push(...renderingPerformanceExtensions);
	pushExtension(extensions, options.pointerCursorVisibilityExtension);
	pushExtension(extensions, options.shiftClickSelectionExtension);
	pushExtension(extensions, options.multiCursorSelectionExtension);
	pushExtension(extensions, options.touchSelectionUpdateExtension);
	pushExtension(extensions, options.quickToolsModifierInputExtension);
	if (options.searchExtension != null) {
		extensions.push(options.searchExtension, searchMatchHighlighter);
	}
	pushExtension(extensions, options.readOnlyExtension);

	if (options.optionExtensions?.length) {
		extensions.push(...options.optionExtensions);
	}

	return extensions;
}

export default createMainEditorExtensions;
