import { EditorView, ViewPlugin } from "@codemirror/view";

interface VirtualKeyboardControl {
	show(): void;
}

function keyboardControl(view: EditorView): VirtualKeyboardControl | null {
	const navigator = view.dom.ownerDocument.defaultView?.navigator as
		| (Navigator & {
				virtualKeyboard?: VirtualKeyboardControl;
		  })
		| undefined;
	if (!navigator) return null;
	return /Android\b/.test(navigator.userAgent) &&
		"virtualKeyboardPolicy" in view.contentDOM &&
		typeof navigator.virtualKeyboard?.show === "function"
		? navigator.virtualKeyboard
		: null;
}

// Android may open the IME on finger-down even though DOM focus never changed.
// Keep keyboard visibility independent of focus and virtualized DOM selection.
// https://developer.chrome.com/docs/web-platform/virtual-keyboard#the-virtual-keyboard-policy
class KeyboardInput {
	private pointer: {
		id: number;
		x: number;
		y: number;
		at: number;
		moved: boolean;
	} | null = null;
	private tap = false;

	constructor(private view: EditorView) {
		if (!keyboardControl(view)) return;
		view.contentDOM.addEventListener("pointerdown", this.onDown, true);
		view.dom.ownerDocument.addEventListener("pointermove", this.onMove, true);
		view.dom.ownerDocument.addEventListener("pointerup", this.onUp, true);
		view.dom.ownerDocument.addEventListener(
			"pointercancel",
			this.onCancel,
			true,
		);
		view.contentDOM.addEventListener("click", this.onClick);
	}

	private isContent(target: EventTarget | null) {
		if (!(target instanceof Element) || !this.view.contentDOM.contains(target))
			return false;
		return !target.closest(
			"input, textarea, select, button, a, [contenteditable=false]",
		);
	}

	private onDown = (event: PointerEvent) => {
		this.tap = false;
		this.pointer =
			event.isPrimary && event.button === 0 && this.isContent(event.target)
				? {
						id: event.pointerId,
						x: event.clientX,
						y: event.clientY,
						at: event.timeStamp,
						moved: false,
					}
				: null;
	};
	private onMove = (event: PointerEvent) => {
		const pointer = this.pointer;
		if (
			pointer?.id === event.pointerId &&
			Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) >= 6
		)
			pointer.moved = true;
	};
	private onUp = (event: PointerEvent) => {
		const pointer = this.pointer;
		if (!pointer || pointer.id !== event.pointerId) return;
		this.onMove(event);
		this.tap =
			!pointer.moved &&
			event.timeStamp - pointer.at <= 500 &&
			this.isContent(event.target);
		this.pointer = null;
	};
	private onCancel = () => {
		this.pointer = null;
		this.tap = false;
	};
	private onClick = (event: MouseEvent) => {
		const deliberate = this.tap || event.detail === 0; // Accessibility activation.
		this.tap = false;
		if (
			!keyboardControl(this.view) ||
			!deliberate ||
			event.defaultPrevented ||
			!this.isContent(event.target)
		)
			return;
		if (
			!this.view.state.readOnly &&
			this.view.state.facet(EditorView.editable)
		) {
			if (!this.view.hasFocus) this.view.focus();
			this.show();
		}
	};

	show() {
		if (
			this.view.hasFocus &&
			!this.view.state.readOnly &&
			this.view.state.facet(EditorView.editable)
		)
			keyboardControl(this.view)?.show();
	}

	destroy() {
		this.view.contentDOM.removeEventListener("pointerdown", this.onDown, true);
		this.view.dom.ownerDocument.removeEventListener(
			"pointermove",
			this.onMove,
			true,
		);
		this.view.dom.ownerDocument.removeEventListener(
			"pointerup",
			this.onUp,
			true,
		);
		this.view.dom.ownerDocument.removeEventListener(
			"pointercancel",
			this.onCancel,
			true,
		);
		this.view.contentDOM.removeEventListener("click", this.onClick);
	}
}

const keyboardInputPlugin = ViewPlugin.fromClass(KeyboardInput);

export const keyboardInput = [
	EditorView.contentAttributes.of((view) =>
		keyboardControl(view) ? { virtualkeyboardpolicy: "manual" } : null,
	),
	keyboardInputPlugin,
];

/** Call after an explicit editing command focuses the editor, never on resize/scroll. */
export function showEditorKeyboard(view: EditorView) {
	view.plugin(keyboardInputPlugin)?.show();
}
