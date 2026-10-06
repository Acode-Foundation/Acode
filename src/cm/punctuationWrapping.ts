import {
	Decoration,
	type DecorationSet,
	EditorView,
	MatchDecorator,
	ViewPlugin,
	type ViewUpdate,
	WidgetType,
} from "@codemirror/view";

// VS Code's default wordWrapBreak{After,Before}Characters:
// https://github.com/microsoft/vscode/blob/main/src/vs/editor/common/config/editorOptions.ts
const after = " \t})]?|/&.,;¢°′″‰℃、。｡､￠，．：；？！％・･ゝゞヽヾーァィゥェォッャュョヮヵヶぁぃぅぇぉっゃゅょゎゕゖㇰㇱㇲㇳㇴㇵㇶㇷㇸㇹㇺㇻㇼㇽㇾㇿ々〻ｧｨｩｪｫｬｭｮｯｰ”〉》」』】〕）］｝｣";
const before = "([{‘“〈《「『【〔（［｛｢£¥＄￡￥+＋";
const escapeClass = (text: string) => text.replace(/[\\\]\[\-^]/g, "\\$&");

class WrapOpportunity extends WidgetType {
	toDOM(view: EditorView): HTMLElement {
		return view.dom.ownerDocument.createElement("wbr");
	}
}

const opportunity = Decoration.widget({
	widget: new WrapOpportunity(),
	side: 1,
});
const matcher = new MatchDecorator({
	// Consume the character before each boundary. Keep runs of closing
	// punctuation together and break before a run of opening punctuation.
	// Whitespace already provides native breaks, so needs no widget.
	regexp: new RegExp(
		`[${escapeClass(after.trim())}](?=[^${escapeClass(after)}])|[^${escapeClass(before)}\\s](?=[${escapeClass(before)}])`,
		"gu",
	),
	decorate: (add, _from, to) => add(to, to, opportunity),
});

/** Add punctuation break opportunities; retain native layout and long-word wrapping. */
export const punctuationWrapping = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;

		constructor(view: EditorView) {
			this.decorations = matcher.createDeco(view);
		}

		update(update: ViewUpdate) {
			this.decorations = matcher.updateDeco(update, this.decorations);
		}
	},
	{ decorations: (value) => value.decorations },
);
