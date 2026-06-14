import { type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

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
			height = 1000;
			attrs = { style: "padding-bottom: 1000px" };

			update(update: ViewUpdate) {
				const { view } = update;
				const anyView = view as any;
				const maxScrollHeight =
					(anyView.viewState?.editorHeight ?? 0) -
					view.defaultLineHeight -
					(anyView.documentPadding?.top ?? 0) -
					0.5;
				const height = Math.max(0, Math.round(maxScrollHeight * factor));
				if (height >= 0 && height !== this.height) {
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
