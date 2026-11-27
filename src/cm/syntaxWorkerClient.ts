import { syntaxWorker } from "@acode.app/canvas-view";

function createSyntaxWorker() {
	return new Worker("build/syntaxWorker.js", { name: "syntax" });
}

/**
 * Canvas views parse syntax in one shared worker (src/cm/syntaxWorker.ts).
 * If it can't start, fails, or lacks a document's language, the view parses
 * on the main thread as before.
 */
export const canvasSyntaxWorker = syntaxWorker(createSyntaxWorker);
