import { CanvasView, type CanvasViewConfig } from "@acode.app/canvas-view";
import type { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/**
 * The editor renderers Acode can create. "dom" is CodeMirror's own
 * EditorView; "canvas" is @acode.app/canvas-view, which draws the text with
 * the GPU on CodeMirror's state (opt-in, experimental).
 */
export type EditorRenderer = "dom" | "canvas";

export type CanvasEditorOptions = Omit<CanvasViewConfig, "state" | "parent">;

interface CreateEditorViewOptions {
	state: EditorState;
	parent: HTMLElement;
	/** Options for a canvas view; without them a DOM EditorView is created. */
	canvas?: CanvasEditorOptions | null;
}

let canvasSupport: boolean | null = null;

/**
 * Whether this WebView can run the canvas renderer (it needs WebGL2). The
 * probe context is released right away: pages only get ~16 of them.
 */
export function isCanvasRendererSupported(): boolean {
	if (canvasSupport != null) return canvasSupport;
	try {
		const gl = document.createElement("canvas").getContext("webgl2");
		canvasSupport = !!gl;
		gl?.getExtension("WEBGL_lose_context")?.loseContext();
	} catch {
		canvasSupport = false;
	}
	return canvasSupport;
}

export function isCanvasView(view: unknown): view is CanvasView {
	return view instanceof CanvasView;
}

/**
 * Create the editor view for a pane. Code after construction treats both
 * kinds the same: CanvasView implements the EditorView members Acode and
 * CodeMirror's commands use (`state`, `dispatch`, `setState`, `scrollDOM`,
 * `contentDOM`, `coordsAtPos`, `requestMeasure`...).
 */
export default function createEditorView({
	state,
	parent,
	canvas = null,
}: CreateEditorViewOptions): EditorView {
	if (canvas) {
		// `view instanceof EditorView` holds for canvas views too.
		return new CanvasView({
			...canvas,
			state,
			parent,
		}) as unknown as EditorView;
	}
	return new EditorView({ state, parent });
}
