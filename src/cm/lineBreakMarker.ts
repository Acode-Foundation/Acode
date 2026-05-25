import { Decoration, DecorationSet, ViewPlugin, WidgetType, EditorView, ViewUpdate } from "@codemirror/view";

class NewlineWidget extends WidgetType {
	toDOM(): HTMLElement {
		let span = document.createElement("span");
		span.textContent = "¬";
		span.className = "cm-newline-marker";
		return span;
	}
	eq(other: WidgetType): boolean {
		return other instanceof NewlineWidget;
	}
}

export const lineBreakMarkerPlugin = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;

		constructor(view: EditorView) {
			this.decorations = this.getDecorations(view);
		}

		update(update: ViewUpdate) {
			if (update.docChanged || update.viewportChanged) {
				this.decorations = this.getDecorations(update.view);
			}
		}

		getDecorations(view: EditorView): DecorationSet {
			let widgets: any[] = [];
			for (let { from, to } of view.visibleRanges) {
				for (let pos = from; pos <= to; ) {
					let line = view.state.doc.lineAt(pos);
					if (line.number < view.state.doc.lines) {
						let deco = Decoration.widget({
							widget: new NewlineWidget(),
							side: 1,
						});
						widgets.push(deco.range(line.to));
					}
					pos = line.to + 1;
				}
			}
			return Decoration.set(widgets);
		}
	},
	{
		decorations: (v) => v.decorations,
	},
);

export const lineBreakMarkerTheme = EditorView.theme({
	".cm-newline-marker": {
		color: "var(--cm-space-marker-color, rgba(127, 127, 127, 0.6))",
		pointerEvents: "none",
		userSelect: "none",
	},
});

export const lineBreakMarker = [lineBreakMarkerPlugin, lineBreakMarkerTheme];

export default lineBreakMarker;
