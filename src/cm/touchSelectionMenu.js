import { EditorSelection } from "@codemirror/state";
import selectionMenu from "lib/selectionMenu";

const TAP_MAX_DELAY = 500;
const TAP_MAX_DISTANCE = 20;
const EDGE_SCROLL_GAP = 40;
const MENU_MARGIN = 10;
const MENU_SHOW_DELAY = 120;
const MENU_CARET_GAP = 10;
const MENU_SELECTION_GAP = 12;
const MENU_HANDLE_CLEARANCE = 28;
const TAP_MAX_COLUMN_DELTA = 2;
const TAP_MAX_POS_DELTA = 2;

/**
 * Classify taps into single/double/triple tap buckets.
 * @param {{x:number,y:number,time:number,count:number}|null} previousTap
 * @param {{x:number,y:number,time:number}} tap
 * @returns {{x:number,y:number,time:number,count:number}}
 */
export function classifyTap(previousTap, tap) {
	if (!previousTap) {
		return { ...tap, count: 1 };
	}

	const dt = tap.time - previousTap.time;
	const dx = tap.x - previousTap.x;
	const dy = tap.y - previousTap.y;
	const distance = Math.hypot(dx, dy);
	const sameTextZone =
		tap.line != null &&
		previousTap.line != null &&
		tap.line === previousTap.line &&
		Math.abs((tap.column ?? 0) - (previousTap.column ?? 0)) <=
			TAP_MAX_COLUMN_DELTA;
	const nearSamePos =
		tap.pos != null &&
		previousTap.pos != null &&
		Math.abs(tap.pos - previousTap.pos) <= TAP_MAX_POS_DELTA;

	if (
		dt <= TAP_MAX_DELAY &&
		(distance <= TAP_MAX_DISTANCE || sameTextZone || nearSamePos)
	) {
		return {
			...tap,
			count: Math.min(previousTap.count + 1, 3),
		};
	}

	return { ...tap, count: 1 };
}

/**
 * Clamp menu coordinates so it stays within the container bounds.
 * @param {{left:number, top:number, width:number, height:number}} menuRect
 * @param {{left:number, top:number, width:number, height:number}} containerRect
 * @returns {{left:number, top:number}}
 */
export function clampMenuPosition(menuRect, containerRect) {
	const maxLeft = Math.max(
		containerRect.left + MENU_MARGIN,
		containerRect.left + containerRect.width - menuRect.width - MENU_MARGIN,
	);
	const maxTop = Math.max(
		containerRect.top + MENU_MARGIN,
		containerRect.top + containerRect.height - menuRect.height - MENU_MARGIN,
	);

	return {
		left: clamp(menuRect.left, containerRect.left + MENU_MARGIN, maxLeft),
		top: clamp(menuRect.top, containerRect.top + MENU_MARGIN, maxTop),
	};
}

/**
 * Filter menu items using Ace-compatible rules.
 * @param {ReturnType<typeof selectionMenu>} items
 * @param {{readOnly:boolean,hasSelection:boolean}} options
 */
export function filterSelectionMenuItems(items, options) {
	const { readOnly, hasSelection } = options;
	return items.filter((item) => {
		if (readOnly && !item.readOnly) return false;
		if (hasSelection && !["selected", "all"].includes(item.mode)) return false;
		if (!hasSelection && item.mode === "selected") return false;
		return true;
	});
}

/**
 * Detect which edge(s) should trigger drag auto-scroll.
 * @param {{
 *   x:number,
 *   y:number,
 *   rect:{left:number,right:number,top:number,bottom:number},
 *   allowHorizontal?:boolean,
 *   gap?:number,
 * }} options
 * @returns {{horizontal:number, vertical:number}}
 */
export function getEdgeScrollDirections(options) {
	const { x, y, rect, allowHorizontal = true, gap = EDGE_SCROLL_GAP } = options;
	let horizontal = 0;
	let vertical = 0;

	if (allowHorizontal) {
		if (x < rect.left + gap) horizontal = -1;
		else if (x > rect.right - gap) horizontal = 1;
	}

	if (y < rect.top + gap) vertical = -1;
	else if (y > rect.bottom - gap) vertical = 1;

	return { horizontal, vertical };
}

function clamp(value, min, max) {
	return Math.max(min, Math.min(max, value));
}

export default function createTouchSelectionMenu(view, options = {}) {
	return new TouchSelectionMenuController(view, options);
}

class TouchSelectionMenuController {
	#view;
	#container;
	#getActiveFile;
	#isShiftSelectionActive;
	#stateSyncRaf = 0;
	#isScrolling = false;
	#isPointerInteracting = false;
	#shiftSelectionSession = null;
	#pendingShiftSelectionClick = null;
	#menuActive = false;
	#menuRequested = false;
	#enabled = true;
	#handlingMenuAction = false;
	#menuShowTimer = null;

	constructor(view, options = {}) {
		this.#view = view;
		this.#container =
			options.container || view.dom.closest(".editor-container") || view.dom;
		this.#getActiveFile = options.getActiveFile || (() => null);
		this.#isShiftSelectionActive =
			options.isShiftSelectionActive || (() => false);
		this.$menu = document.createElement("menu");
		this.$menu.className = "cursor-menu";
		this.#bindEvents();
	}

	#bindEvents() {
		const root = this.#view.dom;
		root.addEventListener("contextmenu", this.#onContextMenu, true);
		document.addEventListener("pointerdown", this.#onGlobalPointerDown, true);
		document.addEventListener("pointerup", this.#onGlobalPointerUp, true);
		document.addEventListener("pointercancel", this.#onGlobalPointerUp, true);
	}

	destroy() {
		const root = this.#view.dom;
		root.removeEventListener("contextmenu", this.#onContextMenu, true);
		document.removeEventListener(
			"pointerdown",
			this.#onGlobalPointerDown,
			true,
		);
		document.removeEventListener("pointerup", this.#onGlobalPointerUp, true);
		document.removeEventListener(
			"pointercancel",
			this.#onGlobalPointerUp,
			true,
		);
		this.#clearMenuShowTimer();
		cancelAnimationFrame(this.#stateSyncRaf);
		this.#stateSyncRaf = 0;
		this.#shiftSelectionSession = null;
		this.#pendingShiftSelectionClick = null;
		this.#hideMenu(true);
	}

	setEnabled(enabled) {
		this.#enabled = !!enabled;
		if (this.#enabled) return;
		this.#shiftSelectionSession = null;
		this.#pendingShiftSelectionClick = null;
		this.#menuRequested = false;
		this.#isPointerInteracting = false;
		this.#isScrolling = false;
		this.#clearMenuShowTimer();
		cancelAnimationFrame(this.#stateSyncRaf);
		this.#stateSyncRaf = 0;
		this.#hideMenu(true);
	}

	setSelection(value) {
		if (!this.#enabled) return;
		if (value) {
			this.#menuRequested = true;
		}
		this.onStateChanged({
			pointerTriggered: !!value,
			selectionChanged: true,
		});
	}

	setMenu(value) {
		this.#menuRequested = !!value;
		if (!this.#enabled) return;
		if (!value) {
			this.#clearMenuShowTimer();
			this.#hideMenu();
			return;
		}
		this.#scheduleMenuShow(MENU_SHOW_DELAY);
	}

	isMenuVisible() {
		return this.#menuActive && this.$menu.isConnected;
	}

	onScrollStart() {
		if (!this.#enabled) return;
		if (this.#isScrolling) return;
		this.#clearMenuShowTimer();
		this.#isScrolling = true;
		this.#hideMenu();
	}

	onScrollEnd() {
		if (!this.#enabled || !this.#isScrolling) return;
		this.#isScrolling = false;
		if (this.#shouldShowMenu()) this.#scheduleMenuShow(MENU_SHOW_DELAY);
	}

	onStateChanged(meta = {}) {
		if (!this.#enabled) return;
		if (this.#handlingMenuAction) return;
		if (meta.selectionChanged && this.#menuActive) {
			this.#hideMenu();
		}
		if (!this.#shouldShowMenu()) {
			if (!this.#hasSelection()) {
				this.#menuRequested = false;
			}
			this.#clearMenuShowTimer();
			this.#hideMenu();
			return;
		}
		const delay =
			meta.pointerTriggered || meta.selectionChanged ? MENU_SHOW_DELAY : 0;
		this.#scheduleMenuShow(delay);
	}

	onSessionChanged() {
		if (!this.#enabled) return;
		this.#shiftSelectionSession = null;
		this.#pendingShiftSelectionClick = null;
		this.#menuRequested = false;
		this.#isPointerInteracting = false;
		this.#isScrolling = false;
		this.#clearMenuShowTimer();
		this.#hideMenu(true);
	}

	#onContextMenu = (event) => {
		if (!this.#enabled) return;
		if (this.#isIgnoredPointerTarget(event.target)) return;
		event.preventDefault();
		event.stopPropagation();
		this.#menuRequested = true;
		this.#scheduleMenuShow(MENU_SHOW_DELAY);
	};

	#onGlobalPointerDown = (event) => {
		const target = event.target;
		if (this.$menu.contains(target)) return;
		if (this.#isIgnoredPointerTarget(target)) {
			this.#shiftSelectionSession = null;
			return;
		}
		if (target instanceof Node && this.#view.dom.contains(target)) {
			this.#captureShiftSelection(event);
			this.#isPointerInteracting = true;
			this.#clearMenuShowTimer();
			this.#hideMenu();
			return;
		}
		this.#shiftSelectionSession = null;
		this.#isPointerInteracting = false;
		this.#menuRequested = false;
		this.#hideMenu();
	};

	#onGlobalPointerUp = (event) => {
		if (event.type === "pointerup") {
			this.#commitShiftSelection(event);
		} else {
			this.#shiftSelectionSession = null;
		}
		if (!this.#isPointerInteracting) return;
		this.#isPointerInteracting = false;
		if (!this.#enabled) return;
		if (this.#shouldShowMenu()) {
			this.#scheduleMenuShow(MENU_SHOW_DELAY);
			return;
		}
		if (!this.#hasSelection()) {
			this.#menuRequested = false;
		}
		this.#hideMenu();
	};

	#captureShiftSelection(event) {
		if (!this.#canExtendSelection(event)) {
			this.#shiftSelectionSession = null;
			return;
		}

		this.#shiftSelectionSession = {
			pointerId: event.pointerId,
			anchor: this.#view.state.selection.main.anchor,
			x: event.clientX,
			y: event.clientY,
		};
	}

	#commitShiftSelection(event) {
		const session = this.#shiftSelectionSession;
		this.#shiftSelectionSession = null;
		if (!session) return;
		if (!this.#canExtendSelection(event)) return;
		if (event.pointerId !== session.pointerId) return;
		if (
			Math.hypot(event.clientX - session.x, event.clientY - session.y) >
			TAP_MAX_DISTANCE
		) {
			return;
		}
		const target = event.target;
		if (!(target instanceof Node) || !this.#view.dom.contains(target)) return;
		if (this.#isIgnoredPointerTarget(target)) return;

		// Rely on pointer coordinates instead of click events so touch selection
		// keeps working when the browser/native path owns the actual tap.
		const head = this.#view.posAtCoords(
			{ x: event.clientX, y: event.clientY },
			false,
		);
		this.#view.dispatch({
			selection: EditorSelection.range(session.anchor, head),
			userEvent: "select.extend",
		});
		this.#pendingShiftSelectionClick = {
			x: event.clientX,
			y: event.clientY,
			timeStamp: event.timeStamp,
		};
		event.preventDefault();
	}

	#canExtendSelection(event) {
		if (!this.#enabled) return false;
		if (!(event.isTrusted && event.isPrimary)) return false;
		if (typeof event.button === "number" && event.button !== 0) return false;
		return !!this.#isShiftSelectionActive(event);
	}

	consumePendingShiftSelectionClick(event) {
		const pending = this.#pendingShiftSelectionClick;
		this.#pendingShiftSelectionClick = null;
		if (!pending || !this.#enabled) return false;
		if (event.timeStamp - pending.timeStamp > TAP_MAX_DELAY) return false;
		if (
			Math.hypot(event.clientX - pending.x, event.clientY - pending.y) >
			TAP_MAX_DISTANCE
		) {
			return false;
		}
		const target = event.target;
		if (!(target instanceof Node) || !this.#view.dom.contains(target))
			return false;
		if (this.#isIgnoredPointerTarget(target)) return false;
		return true;
	}

	#shouldShowMenu() {
		if (this.#isScrolling || this.#isPointerInteracting || !this.#view.hasFocus)
			return false;
		return this.#hasSelection() || this.#menuRequested;
	}

	#scheduleMenuShow(delay = 0) {
		this.#clearMenuShowTimer();
		if (!this.#enabled || this.#isScrolling) return;
		this.#menuShowTimer = setTimeout(() => {
			this.#menuShowTimer = null;
			if (!this.#enabled || this.#isScrolling) return;
			if (!this.#shouldShowMenu()) {
				if (!this.#hasSelection()) {
					this.#menuRequested = false;
				}
				this.#hideMenu();
				return;
			}
			cancelAnimationFrame(this.#stateSyncRaf);
			this.#stateSyncRaf = requestAnimationFrame(() => {
				this.#stateSyncRaf = 0;
				this.#showMenuDeferred();
			});
		}, delay);
	}

	#safeCoordsAtPos(view, pos) {
		try {
			return view.coordsAtPos(pos);
		} catch {
			return null;
		}
	}

	#getMenuAnchor(selection = this.#hasSelection()) {
		const range = this.#view.state.selection.main;
		if (!selection) {
			const caret = this.#safeCoordsAtPos(this.#view, range.head);
			if (!caret) return null;
			return {
				x: (caret.left + caret.right) / 2,
				top: caret.top,
				bottom: caret.bottom,
				hasSelection: false,
			};
		}

		const start = this.#safeCoordsAtPos(this.#view, range.from);
		const end = this.#safeCoordsAtPos(this.#view, range.to);
		const primary = start || end;
		if (!primary) return null;
		const secondary = end || start || primary;
		return {
			x: ((start?.left ?? primary.left) + (end?.left ?? secondary.left)) / 2,
			top: Math.min(primary.top, secondary.top),
			bottom: Math.max(primary.bottom, secondary.bottom),
			hasSelection: true,
		};
	}

	#showMenu(anchor) {
		const hasSelection = this.#hasSelection();
		const items = filterSelectionMenuItems(selectionMenu(), {
			readOnly: this.#isReadOnly(),
			hasSelection,
		});

		this.$menu.innerHTML = "";
		if (!items.length) {
			this.#menuRequested = false;
			this.#hideMenu(true);
			return;
		}

		items.forEach(({ onclick, text }) => {
			const $item = document.createElement("div");
			if (typeof text === "string") {
				$item.textContent = text;
			} else if (text instanceof Node) {
				$item.append(text.cloneNode(true));
			}
			let handled = false;
			const runAction = (event) => {
				if (handled) return;
				handled = true;
				event.preventDefault();
				event.stopPropagation();
				this.#handlingMenuAction = true;
				try {
					onclick?.();
				} finally {
					this.#handlingMenuAction = false;
					this.#menuRequested = false;
					this.#hideMenu();
					this.#view.focus();
				}
			};
			$item.addEventListener("pointerdown", runAction);
			$item.addEventListener("click", runAction);
			this.$menu.append($item);
		});

		if (!this.$menu.isConnected) {
			this.#container.append(this.$menu);
		}

		const containerRect = this.#container.getBoundingClientRect();
		this.$menu.style.left = "0px";
		this.$menu.style.top = "0px";
		this.$menu.style.visibility = "hidden";

		const menuRect = this.$menu.getBoundingClientRect();
		const preferredLeft = anchor.x - menuRect.width / 2;
		const aboveGap = anchor.hasSelection ? MENU_SELECTION_GAP : MENU_CARET_GAP;
		const belowGap = anchor.hasSelection
			? MENU_HANDLE_CLEARANCE
			: MENU_CARET_GAP;
		const topAbove = anchor.top - menuRect.height - aboveGap;
		const topBelow = anchor.bottom + belowGap;
		const minTop = containerRect.top + MENU_MARGIN;
		const maxTop =
			containerRect.top + containerRect.height - menuRect.height - MENU_MARGIN;
		const fitsAbove = topAbove >= minTop;
		const fitsBelow = topBelow <= maxTop;
		const clamped = clampMenuPosition(
			{
				left: preferredLeft,
				top: fitsAbove || !fitsBelow ? topAbove : topBelow,
				width: menuRect.width,
				height: menuRect.height,
			},
			{
				left: containerRect.left,
				top: containerRect.top,
				width: containerRect.width,
				height: containerRect.height,
			},
		);

		this.$menu.style.left = `${clamped.left - containerRect.left}px`;
		this.$menu.style.top = `${clamped.top - containerRect.top}px`;
		this.$menu.style.visibility = "";
		this.#menuActive = true;
		this.#menuRequested = false;
	}

	#showMenuDeferred() {
		if (!this.#enabled || this.#isScrolling || !this.#shouldShowMenu()) return;
		const useSelectionAnchor = this.#hasSelection();
		this.#view.requestMeasure({
			read: () => this.#getMenuAnchor(useSelectionAnchor),
			write: (anchor) => {
				if (!this.#enabled || this.#isScrolling || !this.#shouldShowMenu()) {
					this.#hideMenu();
					return;
				}
				if (!anchor) {
					this.#hideMenu(true);
					return;
				}
				this.#showMenu(anchor);
			},
		});
	}

	#hideMenu(force = false) {
		if (!force && !this.#menuActive && !this.$menu.isConnected) return;
		if (this.$menu.isConnected) {
			this.$menu.remove();
		}
		this.#menuActive = false;
	}

	#clearMenuShowTimer() {
		clearTimeout(this.#menuShowTimer);
		this.#menuShowTimer = null;
	}

	#isReadOnly() {
		const activeFile = this.#getActiveFile();
		if (activeFile?.type === "editor") {
			return !activeFile.editable || !!activeFile.loading;
		}
		return !!this.#view.state?.readOnly;
	}

	#isIgnoredPointerTarget(target) {
		let element = null;
		if (target instanceof Element) {
			element = target;
		} else if (target instanceof Node) {
			element = target.parentElement;
		}
		if (!element) return false;
		if (element.closest(".cm-tooltip, .cm-panel")) return true;
		const editorContent = element.closest(".cm-content");
		if (editorContent && this.#view.dom.contains(editorContent)) {
			return false;
		}
		if (
			element.closest(
				'input, textarea, select, button, a, [contenteditable], [role="button"]',
			)
		) {
			return true;
		}
		return false;
	}

	#hasSelection() {
		const selection = this.#view.state.selection.main;
		return selection.from !== selection.to;
	}
}
