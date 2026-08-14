import {
	Compartment,
	EditorSelection,
	EditorState,
	Transaction,
	type Extension,
	type SelectionRange,
} from "@codemirror/state";
import { EditorView } from "@codemirror/view";

interface PointerTapSnapshot {
	pointerId: number;
	x: number;
	y: number;
	timeStamp: number;
	isPrimary?: boolean;
	button?: number;
	cancelled?: boolean;
}

interface PointerTapEnd {
	pointerId: number;
	x: number;
	y: number;
	timeStamp: number;
	isPrimary?: boolean;
	button?: number;
}

interface PointerTapOptions {
	maxDelay?: number;
	maxDistance?: number;
}

const readOnlyUserChangePattern = /^(?:input|delete|move|undo|redo)(?:\.|$)/;

const readOnlyInputGuard = EditorView.inputHandler.of((view) => {
	return view.state.readOnly;
});

const readOnlyUserChangeFilter = EditorState.transactionFilter.of(
	(transaction) => {
		if (!transaction.startState.readOnly || !transaction.docChanged) {
			return transaction;
		}

		const userEvent = transaction.annotation(Transaction.userEvent);
		return isReadOnlyUserChange(userEvent) ? [] : transaction;
	},
);

const readOnlyFocusGuard = EditorView.domEventHandlers({
	focus(event, view) {
		event.preventDefault();
		blurEditorIfReadOnly(view, view.state.readOnly);
		return true;
	},
	beforeinput(event, view) {
		if (!view.state.readOnly) return false;
		event.preventDefault();
		blurEditorIfReadOnly(view, true);
		return true;
	},
});

const readOnlyCursor = [
	EditorView.editorAttributes.of({ class: "cm-read-only" }),
	EditorView.theme({
		"&.cm-read-only > .cm-scroller > .cm-cursorLayer": {
			animation: "none",
		},
		"&.cm-read-only > .cm-scroller > .cm-cursorLayer .cm-cursor": {
			display: "block",
		},
	}),
];

/**
 * Keep CodeMirror's document and DOM editability in sync.
 */
export function createEditorReadOnlyExtension(readOnly: boolean): Extension {
	return [
		EditorState.readOnly.of(readOnly),
		EditorView.editable.of(!readOnly),
		...(readOnly
			? [
					readOnlyFocusGuard,
					readOnlyInputGuard,
					readOnlyUserChangeFilter,
					readOnlyCursor,
				]
			: []),
	];
}

/** Identify document-changing transactions produced by user interaction. */
export function isReadOnlyUserChange(userEvent: string | undefined): boolean {
	return !!userEvent && readOnlyUserChangePattern.test(userEvent);
}

/** Dismiss an active soft keyboard when an editor becomes read-only. */
export function blurEditorIfReadOnly(
	view: EditorView,
	readOnly: boolean,
): void {
	if (!readOnly) return;
	const activeElement = document.activeElement;
	if (
		activeElement instanceof HTMLElement &&
		view.dom.contains(activeElement)
	) {
		activeElement.blur();
	}
	view.contentDOM.blur();
}

/** Atomically update all read-only behavior controlled by the compartment. */
export function reconfigureEditorReadOnly(
	view: EditorView,
	compartment: Compartment,
	readOnly: boolean,
): void {
	view.dispatch({
		effects: compartment.reconfigure(createEditorReadOnlyExtension(readOnly)),
	});
	blurEditorIfReadOnly(view, readOnly);
}

/** Focus editable editors and actively settle read-only editors unfocused. */
export function focusEditorIfEditable(view: EditorView): boolean {
	if (view.state.readOnly) {
		blurEditorIfReadOnly(view, true);
		return false;
	}
	view.focus();
	return true;
}

/** Classify a completed pointer gesture as a short primary tap. */
export function shouldCommitReadOnlyTap(
	start: PointerTapSnapshot,
	end: PointerTapEnd,
	options: PointerTapOptions = {},
): boolean {
	const { maxDelay = 500, maxDistance = 20 } = options;
	if (start.cancelled) return false;
	if (start.pointerId !== end.pointerId) return false;
	if (start.isPrimary === false || end.isPrimary === false) return false;
	if ((start.button ?? 0) !== 0 || (end.button ?? 0) !== 0) return false;
	const duration = end.timeStamp - start.timeStamp;
	if (!Number.isFinite(duration) || duration < 0 || duration > maxDelay) {
		return false;
	}
	return Math.hypot(end.x - start.x, end.y - start.y) <= maxDistance;
}

/** Place the visual read-only cursor without focusing or editing. */
export function placeReadOnlyCursor(view: EditorView, pos: number): boolean {
	if (!view.state.readOnly) return false;
	const position = Math.max(0, Math.min(pos, view.state.doc.length));
	const selection = EditorSelection.single(position);
	if (!view.state.selection.eq(selection)) {
		view.dispatch({
			selection,
			userEvent: "select.pointer",
		});
	}
	blurEditorIfReadOnly(view, true);
	return true;
}

/** Resolve the text selected by a read-only long-press. */
export function resolveReadOnlyContextSelection(
	state: EditorState,
	pos: number,
): SelectionRange {
	const docLength = state.doc.length;
	const position = Math.max(
		0,
		Math.min(Number.isFinite(pos) ? pos : state.selection.main.head, docLength),
	);
	const current = state.selection.main;

	if (!current.empty && position >= current.from && position <= current.to) {
		return current;
	}

	const word = state.wordAt(position);
	if (word) return word;
	if (docLength === 0) return EditorSelection.cursor(0);

	let from = Math.min(position, docLength - 1);
	const unit = state.doc.sliceString(from, from + 1).charCodeAt(0);
	if (unit >= 0xdc00 && unit <= 0xdfff && from > 0) {
		const previousUnit = state.doc.sliceString(from - 1, from).charCodeAt(0);
		if (previousUnit >= 0xd800 && previousUnit <= 0xdbff) from -= 1;
	}

	const codePoint = state.doc
		.sliceString(from, Math.min(from + 2, docLength))
		.codePointAt(0);
	const width = codePoint != null && codePoint > 0xffff ? 2 : 1;
	return EditorSelection.range(from, Math.min(from + width, docLength));
}
