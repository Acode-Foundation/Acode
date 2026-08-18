import { ViewPlugin, Decoration, WidgetType } from "@codemirror/view";
import { StateField, StateEffect } from "@codemirror/state";

class GhostTextWidget extends WidgetType {
	constructor(public text: string) {
		super();
	}

	eq(other: GhostTextWidget) {
		return this.text === other.text;
	}

	toDOM() {
		const span = document.createElement("span");
		span.className = "cm-ai-ghost-text";
		span.textContent = this.text;
		span.style.opacity = "0.5";
		span.style.fontStyle = "italic";
		return span;
	}
}

const setGhostText = StateEffect.define<{ pos: number; text: string } | null>();

export const ghostTextState = StateField.define<Decoration>({
	create() {
		return Decoration.none;
	},
	update(decorations, tr) {
		decorations = decorations.map(tr.changes);
		for (let e of tr.effects) {
			if (e.is(setGhostText)) {
				if (e.value === null) {
					return Decoration.none;
				}
				return Decoration.set([
					Decoration.widget({
						widget: new GhostTextWidget(e.value.text),
						side: 1,
					}).range(e.value.pos),
				]);
			}
		}
		// If document changed, clear ghost text
		if (tr.docChanged) {
			return Decoration.none;
		}
		return decorations;
	},
	provide: (f) => EditorView.decorations.from(f),
});

export const aiAutocompletePlugin = ViewPlugin.fromClass(
	class {
		timeout: any;
		constructor(public view: any) {}

		update(update: any) {
			if (update.docChanged) {
				import("lib/settings").then((mSettings) => {
					const appSettings = mSettings.default;
					if (appSettings.value.ai?.provider) {
						clearTimeout(this.timeout);
						this.view.dispatch({ effects: setGhostText.of(null) });

						this.timeout = setTimeout(async () => {
							try {
								const pos = this.view.state.selection.main.head;
								const doc = this.view.state.doc.toString();
								const prefix = doc.slice(0, pos);
								const suffix = doc.slice(pos);

								const { default: aiService } = await import("utils/ai/AIService");
								const completion = await aiService.completeCode(prefix, suffix);
								if (completion) {
									this.view.dispatch({
										effects: setGhostText.of({ pos, text: completion }),
									});
								}
							} catch (e) {
								// Ignore errors or log them
							}
						}, 1000); // 1s debounce
					}
				}).catch(() => {});
			}
		}

		destroy() {
			clearTimeout(this.timeout);
		}
	}
);

// We also need a keymap to accept the suggestion
import { keymap } from "@codemirror/view";
export const acceptAiSuggestionKeymap = keymap.of([
	{
		key: "Tab",
		run: (view) => {
			const ghost = view.state.field(ghostTextState, false);
			if (ghost && ghost.size > 0) {
				let textToInsert = "";
				ghost.between(0, view.state.doc.length, (from, to, deco) => {
					textToInsert = (deco.spec.widget as GhostTextWidget).text;
				});
				if (textToInsert) {
					const pos = view.state.selection.main.head;
					view.dispatch({
						changes: { from: pos, insert: textToInsert },
						effects: setGhostText.of(null),
					});
					return true;
				}
			}
			return false;
		},
	},
]);

export function aiAutocomplete() {
	return [ghostTextState, aiAutocompletePlugin, acceptAiSuggestionKeymap];
}
