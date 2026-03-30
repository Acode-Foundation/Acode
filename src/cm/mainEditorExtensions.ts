import type { Extension } from "@codemirror/state";
import { EditorView, scrollPastEnd } from "@codemirror/view";

interface MainEditorExtensionOptions {
	emmetExtensions?: Extension[];
	baseExtensions?: Extension[];
	commandKeymapExtension?: Extension;
	themeExtension?: Extension;
	pointerCursorVisibilityExtension?: Extension;
	shiftClickSelectionExtension?: Extension;
	touchSelectionUpdateExtension?: Extension;
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
	".cm-scroller": { height: "100%", overflow: "auto" },
});

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
	extensions.push(scrollPastEnd());
	pushExtension(extensions, options.pointerCursorVisibilityExtension);
	pushExtension(extensions, options.shiftClickSelectionExtension);
	pushExtension(extensions, options.touchSelectionUpdateExtension);
	pushExtension(extensions, options.searchExtension);
	pushExtension(extensions, options.readOnlyExtension);

	if (options.optionExtensions?.length) {
		extensions.push(...options.optionExtensions);
	}

	return extensions;
}

export default createMainEditorExtensions;
