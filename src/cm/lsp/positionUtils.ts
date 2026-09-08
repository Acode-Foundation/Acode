import type { Text } from "@codemirror/state";

/** Convert an LSP position to an offset without reading outside the document. */
export function safeLspPositionToOffset(
	doc: Pick<Text, "length" | "lines" | "line">,
	position: { line: number; character: number },
): number {
	if (position.line < 0) return 0;
	if (position.line >= doc.lines) return doc.length;

	const line = doc.line(position.line + 1);
	const character = Number.isFinite(position.character)
		? Math.max(0, Math.min(position.character, line.length))
		: 0;
	return line.from + character;
}
