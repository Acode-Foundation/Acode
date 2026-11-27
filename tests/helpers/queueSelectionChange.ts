import { afterAll, beforeAll } from "vitest";

// happy-dom dispatches selectionchange synchronously from Selection methods,
// while browsers queue it as a task. CodeMirror's view flushes on every
// selectionchange, so a synchronous one fired while the view syncs its own
// DOM selection re-enters EditorView.update. Queue it like a browser does.
export function queueSelectionChange() {
	const dispatchDocumentEvent = document.dispatchEvent;

	beforeAll(() => {
		document.dispatchEvent = function (event) {
			if (event.type !== "selectionchange") {
				return dispatchDocumentEvent.call(this, event);
			}
			setTimeout(() => dispatchDocumentEvent.call(this, event));
			return true;
		};
	});

	afterAll(() => {
		document.dispatchEvent = dispatchDocumentEvent;
	});
}
