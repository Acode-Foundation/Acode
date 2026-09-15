import { type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

// Browsing survives keyboard open/close. Only an explicit selection or edit
// resumes following the caret. Keep this state per view, including split panes.
class KeyboardScroll {
	browsing = false;
	private touchStart: { x: number; y: number } | null = null;

	constructor(private view: EditorView) {
		view.scrollDOM.addEventListener("touchstart", this.onTouchStart, {
			passive: true,
		});
		view.scrollDOM.addEventListener("touchmove", this.onTouchMove, {
			passive: true,
		});
		view.scrollDOM.addEventListener("touchend", this.onTouchEnd, {
			passive: true,
		});
		view.scrollDOM.addEventListener("touchcancel", this.onTouchEnd, {
			passive: true,
		});
		view.scrollDOM.addEventListener("wheel", this.onWheel, { passive: true });
	}

	update(update: ViewUpdate) {
		if (update.docChanged || update.selectionSet) this.browsing = false;
	}

	private onTouchStart = (event: TouchEvent) => {
		const touch = event.touches.length === 1 ? event.touches[0] : null;
		this.touchStart = touch ? { x: touch.clientX, y: touch.clientY } : null;
	};
	private onTouchMove = (event: TouchEvent) => {
		if (!this.touchStart || event.touches.length !== 1) return;
		const touch = event.touches[0];
		if (
			Math.max(
				Math.abs(touch.clientX - this.touchStart.x),
				Math.abs(touch.clientY - this.touchStart.y),
			) >= 6
		) {
			this.browsing = true;
		}
	};
	private onTouchEnd = () => {
		this.touchStart = null;
	};
	private onWheel = (event: WheelEvent) => {
		if (event.deltaX || event.deltaY) this.browsing = true;
	};

	destroy() {
		this.view.scrollDOM.removeEventListener("touchstart", this.onTouchStart);
		this.view.scrollDOM.removeEventListener("touchmove", this.onTouchMove);
		this.view.scrollDOM.removeEventListener("touchend", this.onTouchEnd);
		this.view.scrollDOM.removeEventListener("touchcancel", this.onTouchEnd);
		this.view.scrollDOM.removeEventListener("wheel", this.onWheel);
	}
}

export const keyboardScroll = ViewPlugin.fromClass(KeyboardScroll);

export function markKeyboardScrollBrowsing(view: EditorView) {
	const policy = view.plugin(keyboardScroll);
	if (policy) policy.browsing = true;
}

type KeyboardTransition =
	| "keyboardShowStart"
	| "keyboardShow"
	| "keyboardHideStart"
	| "keyboardHide";
interface KeyboardEvents {
	on(name: KeyboardTransition, callback: () => void): void;
	off(name: KeyboardTransition, callback: () => void): void;
}

export function registerKeyboardCursorReveal(options: {
	events: KeyboardEvents;
	getView: () => EditorView | null;
	canReveal: () => boolean;
}) {
	const { events, getView, canReveal } = options;
	const measureKey = {};
	let disposed = false;
	let generation = 0;
	function show() {
		const current = ++generation;
		const view = getView();
		if (!view) return;
		const policy = view.plugin(keyboardScroll);
		const allowed = () =>
			!disposed &&
			current === generation &&
			getView() === view &&
			view.hasFocus &&
			view.plugin(keyboardScroll) === policy &&
			!policy?.browsing &&
			canReveal();
		if (!allowed()) return;
		view.requestMeasure({
			key: measureKey,
			read: () => {
				if (!allowed()) return null;
				const caret = view.coordsAtPos(view.state.selection.main.head);
				if (!caret) return null;
				const scroller = view.scrollDOM;
				const rect = scroller.getBoundingClientRect();
				const top = rect.top + 16;
				const bottom = rect.top + scroller.clientHeight - 24;
				const delta =
					caret.top < top
						? caret.top - top
						: caret.bottom > bottom
							? caret.bottom - bottom
							: 0;
				return delta ? Math.max(0, scroller.scrollTop + delta) : null;
			},
			write: (top) => {
				if (top != null && allowed()) view.scrollDOM.scrollTop = top;
			},
		});
	}
	events.on("keyboardShowStart", show);
	events.on("keyboardShow", show);
	const hide = () => {
		generation++;
	};
	events.on("keyboardHideStart", hide);
	events.on("keyboardHide", hide);
	// Closing the keyboard increases the visible area. It must never pull the
	// viewport back to an old caret position.
	return () => {
		disposed = true;
		events.off("keyboardShowStart", show);
		events.off("keyboardShow", show);
		events.off("keyboardHideStart", hide);
		events.off("keyboardHide", hide);
	};
}
