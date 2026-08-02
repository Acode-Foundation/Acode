import { type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

/**
 * Adds space after the longest line so unwrapped text can scroll away from the
 * right edge of the viewport. CodeMirror's line-wrapping class is placed on the
 * content element, which lets the same extension disable the extra width when
 * wrapping is enabled.
 */
export function horizontalScrollPastEnd(distance: number): Extension {
	const width = Number.isFinite(distance)
		? Math.max(0, Math.round(distance))
		: 0;
	if (width === 0) return [];

	return EditorView.theme({
		".cm-content:not(.cm-lineWrapping)": {
			paddingRight: `${width}px`,
		},
	});
}

/**
 * Returns an extension that adds a customizable bottom margin to the editor.
 * @param factor The scaling factor for the margin (e.g., 0.25 for small, 0.5 for medium, 1.0 for full).
 */
export function scrollPastEndCustom(factor: number): Extension {
	if (factor <= 0) {
		return [];
	}

	const plugin = ViewPlugin.fromClass(
		class {
			height = 0;
			attrs = { style: "" };

			update(update: ViewUpdate) {
				const { view } = update;
				const anyView = view as any;
				const maxScrollHeight =
					(anyView.viewState?.editorHeight ?? 0) -
					view.defaultLineHeight -
					(anyView.documentPadding?.top ?? 0) -
					0.5;
				const height = Math.max(0, Math.round(maxScrollHeight * factor));
				if (height !== this.height) {
					this.height = height;
					this.attrs = { style: `padding-bottom: ${height}px` };
				}
			}
		},
	);

	return [
		plugin,
		EditorView.contentAttributes.of(
			(view) => view.plugin(plugin)?.attrs || null,
		),
	];
}

export default scrollPastEndCustom;
