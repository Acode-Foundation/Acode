import openFile from "lib/openFile";

let currentNavigation;

/** Open a search match and reveal its zero-based row/column range. */
export default async function navigateToResult(url, position) {
	currentNavigation?.abort();
	const navigation = new AbortController();
	currentNavigation = navigation;
	const { signal } = navigation;

	try {
		// Start immediately even if an obsolete filesystem operation is stalled.
		// openFile checks the signal before creating/activating a late result.
		await openFile(url, { render: true, signal });
		const file = editorManager.getFile(url, "uri");
		if (
			signal.aborted ||
			file?.type !== "editor" ||
			editorManager.activeFile !== file
		) {
			return false;
		}

		// load() reuses a restored tab's in-flight load. Do not cancel that shared
		// load; only discard this request's reveal if a newer result is selected.
		await file.load();
		if (
			signal.aborted ||
			!file.loaded ||
			file.loading ||
			editorManager.activeFile !== file ||
			editorManager.getFile(url, "uri") !== file
		) {
			return false;
		}

		const doc = editorManager.editor.state.doc;
		const from = positionToOffset(doc, position.start);
		const to = positionToOffset(doc, position.end);
		// Cancel delayed tab scroll restoration and scrollbar locks before reveal.
		return editorManager.revealRange(from, to, {
			y: "center",
			userEvent: "select.search",
		});
	} catch (error) {
		if (signal.aborted) return false;
		throw error;
	} finally {
		if (currentNavigation === navigation) currentNavigation = undefined;
	}
}

function positionToOffset(doc, { row, column }) {
	// Search results can outlive edits to the file. Clamp both coordinates so
	// an older result still navigates to the nearest available position.
	const line = doc.line(Math.max(1, Math.min(row + 1, doc.lines)));
	return line.from + Math.max(0, Math.min(column, line.length));
}
