import openFile from "lib/openFile";

let latestRequest = 0;
let pendingNavigation = Promise.resolve();

/** Open a search match and reveal its zero-based row/column range. */
export default function navigateToResult(url, position) {
	const request = ++latestRequest;

	// Opening a file activates it. Serialize opens so a slow, older request
	// cannot activate its tab after the user's latest result has been revealed.
	pendingNavigation = pendingNavigation
		.catch(() => {})
		.then(async () => {
			if (request !== latestRequest) return false;
			await openFile(url, { render: true });

			const file = editorManager.getFile(url, "uri");
			if (
				request !== latestRequest ||
				file?.type !== "editor" ||
				editorManager.activeFile !== file
			) {
				return false;
			}

			// Restored tabs may still contain an empty document or a loading preview.
			// load() reuses the in-flight load and resolves after the final state swap.
			await file.load();
			if (
				request !== latestRequest ||
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
			// This cancels delayed tab scroll restoration and scrollbar locks before
			// selecting, scrolling, and focusing the target editor (including panes).
			return editorManager.revealRange(from, to, {
				y: "center",
				userEvent: "select.search",
			});
		});
	return pendingNavigation;
}

function positionToOffset(doc, { row, column }) {
	// Search results can outlive edits to the file. Clamp both coordinates so
	// an older result still navigates to the nearest available position.
	const line = doc.line(Math.max(1, Math.min(row + 1, doc.lines)));
	return line.from + Math.max(0, Math.min(column, line.length));
}
