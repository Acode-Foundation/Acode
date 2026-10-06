// @vitest-environment happy-dom

import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { indentedLineWrapping } from "cm/indentedLineWrapping";
import { punctuationWrapping } from "cm/punctuationWrapping";
import { afterEach, describe, expect, it } from "vitest";

const views: EditorView[] = [];
afterEach(() => {
	for (const view of views.splice(0)) view.destroy();
	document.body.replaceChildren();
});

function editor(doc: string) {
	const wrapping = new Compartment();
	const view = new EditorView({
		state: EditorState.create({
			doc,
			extensions: wrapping.of(indentedLineWrapping("none")),
		}),
		parent: document.body,
	});
	views.push(view);
	return { view, wrapping };
}

function breaks(view: EditorView) {
	const positions: number[] = [];
	view.plugin(punctuationWrapping)?.decorations.between(
		0,
		view.state.doc.length,
		(from) => {
			positions.push(from);
		},
	);
	return positions;
}

describe("punctuation wrapping", () => {
	it("adds breaks after commas and before opening brackets without spaces", () => {
		const { view } = editor("foo(alpha,beta,gamma)");
		expect(breaks(view)).toEqual([3, 10, 15]);
		expect(view.contentDOM.textContent).toBe("foo(alpha,beta,gamma)");
	});

	it("keeps punctuation runs together and does not add equals or whitespace breaks", () => {
		const { view } = editor("a=bbbb c   d\ta([{x})],y+z");
		expect(breaks(view)).toEqual([14, 22, 23]);
	});

	it("supports Unicode punctuation without splitting surrogate pairs", () => {
		const { view } = editor("😀+猫、犬");
		expect(breaks(view)).toEqual([2, 5]);
	});

	it("updates after edits and removes widgets when wrapping is disabled", () => {
		const { view, wrapping } = editor("alpha,beta");
		expect(breaks(view)).toEqual([6]);
		view.dispatch({ changes: { from: 5, to: 6, insert: "=" } });
		expect(breaks(view)).toEqual([]);
		view.dispatch({ changes: { from: 5, to: 6, insert: "," } });
		expect(breaks(view)).toEqual([6]);
		view.dispatch({ effects: wrapping.reconfigure([]) });
		expect(view.contentDOM.querySelector("wbr")).toBeNull();
		expect(view.state.doc.toString()).toBe("alpha,beta");
	});
});
