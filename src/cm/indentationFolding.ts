import {
	foldService,
	language,
	StreamLanguage,
} from "@codemirror/language";
import { countColumn, type EditorState } from "@codemirror/state";

interface FoldRange {
	from: number;
	to: number;
}

const foldCache = new WeakMap<
	EditorState,
	Map<number, FoldRange | null>
>();

function findIndentationFold(
	state: EditorState,
	from: number,
): FoldRange | null {
	const activeLanguage = state.facet(language);
	if (activeLanguage && !(activeLanguage instanceof StreamLanguage)) {
		return null;
	}

	const line = state.doc.lineAt(from);
	let stateCache = foldCache.get(state);
	if (!stateCache) {
		stateCache = new Map();
		foldCache.set(state, stateCache);
	}
	if (stateCache.has(line.from)) return stateCache.get(line.from) ?? null;

	const indentationEnd = line.text.search(/\S|$/);
	if (indentationEnd === line.text.length) {
		stateCache.set(line.from, null);
		return null;
	}

	const indentation = countColumn(line.text, state.tabSize, indentationEnd);
	let foldEnd: number | null = null;

	for (
		let lineNumber = line.number + 1;
		lineNumber <= state.doc.lines;
		lineNumber++
	) {
		const nextLine = state.doc.line(lineNumber);
		const nextIndentationEnd = nextLine.text.search(/\S|$/);
		if (nextIndentationEnd === nextLine.text.length) continue;

		const nextIndentation = countColumn(
			nextLine.text,
			state.tabSize,
			nextIndentationEnd,
		);
		if (nextIndentation <= indentation) break;

		foldEnd = nextLine.to;
	}

	const range =
		foldEnd === null ? null : { from: line.to, to: foldEnd };
	stateCache.set(line.from, range);
	return range;
}

export default foldService.of(findIndentationFold);
