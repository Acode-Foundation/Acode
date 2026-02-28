import { EditorSelection } from "@codemirror/state";
import constants from "lib/constants";
import selectionMenu from "lib/selectionMenu";
import appSettings from "lib/settings";
import { getColorRange } from "utils/color/regex";

const TAP_MAX_DELAY = 500;
const TAP_MAX_DISTANCE = 20;
const LONG_PRESS_DELAY = 450;
const EDGE_SCROLL_GAP = 40;
const EDGE_SCROLL_STEP = 16;
const MENU_MARGIN = 10;
const DRAG_FINGER_OFFSET_FACTOR = 1.8;
const HANDLE_HIT_SLOP = 8;
const CURSOR_HANDLE_HIT_SLOP = 2;
const CURSOR_HANDLE_GUARD_MS = 320;
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

function getElementRect($el) {
	if (!$el?.isConnected) return null;
	return $el.getBoundingClientRect();
}

export default function createTouchSelectionMenu(view, options = {}) {
	return new TouchSelectionMenuController(view, options);
}

class TouchSelectionMenuController {
	#view;
	#container;
	#getActiveFile;
	#tap = null;
	#touchSession = null;
	#dragState = null;
	#longPressTimer = null;
	#cursorHideTimer = null;
	#scrollTimeout = null;
	#autoScrollRaf = 0;
	#stateSyncRaf = 0;
	#isScrolling = false;
	#selectionActive = false;
	#menuActive = false;
	#enabled = true;
	#handlingMenuAction = false;
	#pendingPointerTriggered = false;
	#pendingSelectionChanged = false;
	#cursorHandleGuardUntil = 0;
	#pointer = { x: 0, y: 0 };
	#mouseSelecting = false;

	constructor(view, options = {}) {
		this.#view = view;
		this.#container =
			options.container || view.dom.closest(".editor-container") || view.dom;
		this.#getActiveFile = options.getActiveFile || (() => null);

		this.config = {
			teardropSize: appSettings.value.teardropSize,
			teardropTimeout: appSettings.value.teardropTimeout,
			touchMoveThreshold: appSettings.value.touchMoveThreshold,
		};

		this.$start = this.#createHandle("start");
		this.$end = this.#createHandle("end");
		this.$cursor = this.#createHandle("single");
		this.$menu = document.createElement("menu");
		this.$menu.className = "cursor-menu";
		this.$start.addEventListener("touchstart", this.#onStartHandleTouchStart, {
			passive: false,
		});
		this.$end.addEventListener("touchstart", this.#onEndHandleTouchStart, {
			passive: false,
		});
		this.$cursor.addEventListener(
			"touchstart",
			this.#onCursorHandleTouchStart,
			{
				passive: false,
			},
		);

		this.#bindEvents();
		this.#syncHandleSize();
	}

	#createHandle(type) {
		const $handle = document.createElement("span");
		$handle.className = `cursor ${type}`;
		$handle.dataset.size = String(this.config.teardropSize);
		return $handle;
	}

	#bindEvents() {
		const root = this.#view.dom;
		root.addEventListener("touchstart", this.#onTouchStart, {
			passive: false,
			capture: true,
		});
		root.addEventListener("mousedown", this.#onMouseDown, true);
		root.addEventListener("contextmenu", this.#onContextMenu, true);
		document.addEventListener("mouseup", this.#onMouseUp, true);
		document.addEventListener("mousedown", this.#onGlobalPointerDown, true);
		document.addEventListener("touchstart", this.#onGlobalPointerDown, true);

		appSettings.on("update:teardropSize", this.#onTeardropSizeUpdate);
		appSettings.on("update:teardropTimeout", this.#onTeardropTimeoutUpdate);
		appSettings.on(
			"update:touchMoveThreshold",
			this.#onTouchMoveThresholdUpdate,
		);
	}

	destroy() {
		const root = this.#view.dom;
		root.removeEventListener("touchstart", this.#onTouchStart, true);
		root.removeEventListener("mousedown", this.#onMouseDown, true);
		root.removeEventListener("contextmenu", this.#onContextMenu, true);
		document.removeEventListener("mouseup", this.#onMouseUp, true);
		document.removeEventListener("mousedown", this.#onGlobalPointerDown, true);
		document.removeEventListener("touchstart", this.#onGlobalPointerDown, true);
		this.#removeTouchListeners();
		this.#stopAutoScroll();
		this.#clearScrollTimeout();
		cancelAnimationFrame(this.#stateSyncRaf);
		this.#stateSyncRaf = 0;
		this.#pendingPointerTriggered = false;
		this.#pendingSelectionChanged = false;
		this.#clearLongPress();
		this.#clearCursorHideTimer();
		this.#clearSelectionUi();
		this.#hideMenu(true);
		this.$start.removeEventListener(
			"touchstart",
			this.#onStartHandleTouchStart,
		);
		this.$end.removeEventListener("touchstart", this.#onEndHandleTouchStart);
		this.$cursor.removeEventListener(
			"touchstart",
			this.#onCursorHandleTouchStart,
		);
		appSettings.off("update:teardropSize", this.#onTeardropSizeUpdate);
		appSettings.off("update:teardropTimeout", this.#onTeardropTimeoutUpdate);
		appSettings.off(
			"update:touchMoveThreshold",
			this.#onTouchMoveThresholdUpdate,
		);
	}

	setEnabled(enabled) {
		this.#enabled = !!enabled;
		if (!this.#enabled) {
			this.#touchSession = null;
			this.#dragState = null;
			this.#removeTouchListeners();
			this.#stopAutoScroll();
			this.#clearScrollTimeout();
			cancelAnimationFrame(this.#stateSyncRaf);
			this.#stateSyncRaf = 0;
			this.#pendingPointerTriggered = false;
			this.#pendingSelectionChanged = false;
			this.#clearLongPress();
			this.#clearCursorHideTimer();
			this.#clearSelectionUi();
			this.#hideMenu(true);
		}
	}

	setSelection(value) {
		this.#selectionActive = !!value;
		if (!this.#enabled) return;
		if (value && !this.#hasSelection()) {
			this.#selectWordAtCursor();
		}
		this.onStateChanged({ selectionChanged: true, pointerTriggered: !!value });
	}

	setMenu(value) {
		this.#menuActive = !!value;
		if (!this.#enabled) return;
		if (!value) {
			this.#hideMenu();
			return;
		}
		const triggerType = this.#hasSelection() ? "end" : "cursor";
		if (triggerType === "end") {
			this.#selectionActive = true;
			this.#showSelectionHandles();
		} else {
			this.#showCursorHandle();
		}
		this.#showMenuDeferred(triggerType);
	}

	onScroll() {
		if (!this.#enabled) return;
		if (this.#dragState) return;
		this.#clearScrollTimeout();
		this.#isScrolling = true;
		cancelAnimationFrame(this.#stateSyncRaf);
		this.#stateSyncRaf = 0;
		this.#clearSelectionUi();
		this.#hideMenu(false, false);
		this.#scrollTimeout = setTimeout(() => {
			this.#onScrollEnd();
		}, 100);
	}

	#onScrollEnd() {
		this.#scrollTimeout = null;
		if (!this.#enabled) return;
		if (!this.#isScrolling) return;
		this.#isScrolling = false;
		if (this.#dragState) return;

		if (this.#selectionActive && this.#hasSelection()) {
			this.#showSelectionHandles();
		} else {
			this.#showCursorHandle();
		}

		if (this.#menuActive) {
			const triggerType =
				this.#selectionActive && this.#hasSelection() ? "end" : "cursor";
			this.#showMenuDeferred(triggerType);
		}

		if (this.#pendingPointerTriggered || this.#pendingSelectionChanged) {
			this.onStateChanged();
		}
	}

	onStateChanged(meta = {}) {
		if (!this.#enabled) return;
		if (this.#handlingMenuAction) return;
		if (meta.pointerTriggered) this.#pendingPointerTriggered = true;
		if (meta.selectionChanged) this.#pendingSelectionChanged = true;
		if (this.#isScrolling) return;
		cancelAnimationFrame(this.#stateSyncRaf);
		this.#stateSyncRaf = requestAnimationFrame(() => {
			this.#stateSyncRaf = 0;
			this.#applyStateChange();
		});
	}

	onSessionChanged() {
		if (!this.#enabled) return;
		this.#clearSelectionUi();
		this.#hideMenu(true);
		this.#selectionActive = this.#hasSelection();
		this.onStateChanged({
			selectionChanged: true,
			pointerTriggered: this.#selectionActive,
		});
	}

	#onTeardropSizeUpdate = (value) => {
		this.config.teardropSize = value;
		this.#syncHandleSize();
		if (!this.#enabled) return;
		this.onStateChanged({ selectionChanged: true });
	};

	#onTeardropTimeoutUpdate = (value) => {
		this.config.teardropTimeout = value;
	};

	#onTouchMoveThresholdUpdate = (value) => {
		this.config.touchMoveThreshold = value;
	};

	#onGlobalPointerDown = (event) => {
		if (!this.#menuActive || !this.$menu.isConnected) return;
		const target = event.target;
		if (
			this.$menu.contains(target) ||
			this.$start.contains(target) ||
			this.$end.contains(target) ||
			this.$cursor.contains(target)
		) {
			return;
		}
		if (this.#isIgnoredPointerTarget(target)) {
			return;
		}
		if (
			event.type === "touchstart" &&
			target instanceof Node &&
			this.#view.dom.contains(target)
		) {
			this.#hideMenu(false, false);
			return;
		}
		this.#hideMenu();
	};

	#onContextMenu = (event) => {
		if (!this.#enabled) return;
		if (this.#isIgnoredPointerTarget(event.target)) return;
		event.preventDefault();
		event.stopPropagation();

		const { clientX, clientY } = event;
		const moved = this.#moveCursorToCoords(clientX, clientY);
		if (moved == null) return;

		if (!this.#hasSelection()) {
			this.#selectWordAtCursor();
		}

		this.#selectionActive = this.#hasSelection();
		if (this.#selectionActive) {
			this.#showSelectionHandles();
			this.#showMenuDeferred("end");
			return;
		}
		this.#showCursorHandle();
		this.#showMenuDeferred("cursor");
	};

	#onMouseDown = (event) => {
		if (!this.#enabled) return;
		if (event.button !== 0) return;
		if (this.#isIgnoredPointerTarget(event.target)) return;
		this.#mouseSelecting = true;
	};

	#onMouseUp = (event) => {
		if (!this.#enabled) return;
		if (event.button !== 0) return;
		if (!this.#mouseSelecting) return;
		this.#mouseSelecting = false;
		requestAnimationFrame(() => {
			if (!this.#enabled || !this.#hasSelection()) return;
			this.#selectionActive = true;
			this.onStateChanged({
				pointerTriggered: true,
				selectionChanged: true,
			});
		});
	};

	#onTouchStart = (event) => {
		if (!this.#enabled || event.touches.length !== 1) return;
		if (this.#isIgnoredPointerTarget(event.target)) {
			this.#touchSession = null;
			this.#clearLongPress();
			return;
		}
		const touch = event.touches[0];
		const { clientX, clientY } = touch;
		const now = performance.now();
		this.#pointer.x = clientX;
		this.#pointer.y = clientY;

		if (this.#isInHandle(this.$start, clientX, clientY)) {
			event.preventDefault();
			this.#startDrag("start", clientX, clientY);
			return;
		}

		if (this.#isInHandle(this.$end, clientX, clientY)) {
			event.preventDefault();
			this.#startDrag("end", clientX, clientY);
			return;
		}

		if (
			now >= this.#cursorHandleGuardUntil &&
			this.#isInHandle(this.$cursor, clientX, clientY, CURSOR_HANDLE_HIT_SLOP)
		) {
			event.preventDefault();
			this.#startDrag("cursor", clientX, clientY);
			return;
		}

		if (this.#isEdgeGestureStart(clientX)) {
			event.stopPropagation();
			event.stopImmediatePropagation?.();
			return;
		}

		this.#touchSession = {
			startX: clientX,
			startY: clientY,
			moved: false,
			longPressFired: false,
		};

		this.#addTouchListeners();
		this.#clearLongPress();
		this.#longPressTimer = setTimeout(() => {
			if (!this.#touchSession || this.#touchSession.moved) return;
			this.#touchSession.longPressFired = true;
			this.#moveCursorToCoords(clientX, clientY);
			this.#selectWordAtCursor();
			this.#selectionActive = true;
			this.#showSelectionHandles();
			this.#showMenuDeferred("end");
			this.#vibrate();
		}, LONG_PRESS_DELAY);
	};

	#onStartHandleTouchStart = (event) => {
		if (!this.#enabled || event.touches.length !== 1) return;
		const touch = event.touches[0];
		event.preventDefault();
		event.stopPropagation();
		this.#startDrag("start", touch.clientX, touch.clientY);
	};

	#onEndHandleTouchStart = (event) => {
		if (!this.#enabled || event.touches.length !== 1) return;
		const touch = event.touches[0];
		event.preventDefault();
		event.stopPropagation();
		this.#startDrag("end", touch.clientX, touch.clientY);
	};

	#onCursorHandleTouchStart = (event) => {
		if (!this.#enabled || event.touches.length !== 1) return;
		const touch = event.touches[0];
		event.preventDefault();
		event.stopPropagation();
		this.#startDrag("cursor", touch.clientX, touch.clientY);
	};

	#onTouchMove = (event) => {
		if (event.touches.length !== 1) return;
		const touch = event.touches[0];
		const { clientX, clientY } = touch;
		this.#pointer.x = clientX;
		this.#pointer.y = clientY;

		if (this.#dragState) {
			event.preventDefault();
			this.#dragTo(clientX, clientY);
			return;
		}

		if (!this.#touchSession) return;
		const dx = Math.abs(clientX - this.#touchSession.startX);
		const dy = Math.abs(clientY - this.#touchSession.startY);
		if (
			dx >= this.config.touchMoveThreshold ||
			dy >= this.config.touchMoveThreshold
		) {
			this.#clearLongPress();
		}
		if (dx >= TAP_MAX_DISTANCE || dy >= TAP_MAX_DISTANCE) {
			this.#touchSession.moved = true;
		}
	};

	#onTouchEnd = (event) => {
		if (this.#dragState) {
			event.preventDefault();
			this.#finishDrag();
			return;
		}

		const session = this.#touchSession;
		this.#touchSession = null;
		this.#removeTouchListeners();
		this.#clearLongPress();
		if (!session) return;
		if (session.longPressFired || session.moved) return;

		const changedTouch = event.changedTouches?.[0];
		if (!changedTouch) return;
		const { clientX, clientY } = changedTouch;
		const tapMeta = this.#getTapMeta(clientX, clientY);
		const previousTap = this.#tap;

		let tap = classifyTap(previousTap, {
			x: clientX,
			y: clientY,
			time: performance.now(),
			pos: tapMeta.pos,
			line: tapMeta.line,
			column: tapMeta.column,
		});
		if (
			tap.count > 1 &&
			previousTap?.line != null &&
			tapMeta.line != null &&
			(tapMeta.line !== previousTap.line ||
				Math.abs(tapMeta.column - previousTap.column) > TAP_MAX_COLUMN_DELTA)
		) {
			tap = { ...tap, count: 1 };
		}
		this.#tap = tap;

		const tapPos = tapMeta.pos ?? this.#coordsToPos(clientX, clientY);
		if (tapPos == null) return;

		if (tap.count >= 3) {
			event.preventDefault();
			this.#selectLineAtPos(tapPos);
			this.#selectionActive = true;
			this.#showSelectionHandles();
			this.#showMenuDeferred("end");
			this.#vibrate();
			return;
		}

		if (tap.count === 2) {
			event.preventDefault();
			this.#selectWordAtPos(tapPos);
			this.#selectionActive = true;
			this.#showSelectionHandles();
			this.#showMenuDeferred("end");
			this.#vibrate();
			return;
		}

		this.#moveCursorToCoords(clientX, clientY);
		this.#selectionActive = false;
		this.#hideMenu();
		this.#removeSelectionHandles();
		this.#showCursorHandle();
	};

	#addTouchListeners() {
		document.addEventListener("touchmove", this.#onTouchMove, {
			passive: false,
		});
		document.addEventListener("touchend", this.#onTouchEnd, {
			passive: false,
		});
	}

	#removeTouchListeners() {
		document.removeEventListener("touchmove", this.#onTouchMove);
		document.removeEventListener("touchend", this.#onTouchEnd);
	}

	#clearLongPress() {
		clearTimeout(this.#longPressTimer);
		this.#longPressTimer = null;
	}

	#getTapMeta(x, y) {
		const pos = this.#coordsToPos(x, y);
		if (pos == null) {
			return { pos: null, line: null, column: null };
		}
		const lineInfo = this.#view.state.doc.lineAt(pos);
		return {
			pos,
			line: lineInfo.number,
			column: pos - lineInfo.from,
		};
	}

	#vibrate() {
		if (!appSettings.value.vibrateOnTap) return;
		navigator.vibrate?.(constants.VIBRATION_TIME);
	}

	#syncHandleSize() {
		const size = this.config.teardropSize;
		this.$start.dataset.size = size;
		this.$end.dataset.size = size;
		this.$cursor.dataset.size = size;
	}

	#isEdgeGestureStart(x) {
		const edge = constants.SIDEBAR_SLIDE_START_THRESHOLD_PX;
		const width = window.innerWidth || 0;
		return x <= edge || x >= width - edge;
	}

	#isInHandle($el, x, y, hitSlop = HANDLE_HIT_SLOP) {
		const rect = getElementRect($el);
		if (!rect) return false;
		return (
			x >= rect.left - hitSlop &&
			x <= rect.right + hitSlop &&
			y >= rect.top - hitSlop &&
			y <= rect.bottom + hitSlop
		);
	}

	#safeCoordsAtPos(view, pos) {
		try {
			return view.coordsAtPos(pos);
		} catch {
			return null;
		}
	}

	#applyStateChange() {
		const pointerTriggered = this.#pendingPointerTriggered;
		const selectionChanged = this.#pendingSelectionChanged;
		this.#pendingPointerTriggered = false;
		this.#pendingSelectionChanged = false;

		if (this.#hasSelection()) {
			if (pointerTriggered || selectionChanged) {
				this.#selectionActive = true;
			}
			if (this.#selectionActive) {
				this.#showSelectionHandles();
				this.$cursor.remove();
				if (pointerTriggered && !this.#dragState && !this.#mouseSelecting) {
					this.#showMenuDeferred("end");
				}
			}
		} else {
			this.#removeSelectionHandles();
			this.#selectionActive = false;
			this.#showCursorHandle();
		}

		if (this.#menuActive && !this.#dragState && !this.#hasSelection()) {
			this.#hideMenu();
		}
	}

	#showSelectionHandles() {
		if (!this.config.teardropSize || !this.#hasSelection()) {
			this.#removeSelectionHandles();
			return;
		}

		this.#clearCursorHideTimer();
		this.$cursor.remove();
		this.#view.requestMeasure({
			read: (view) => {
				const range = view.state.selection.main;
				const startCoords = this.#safeCoordsAtPos(view, range.from);
				const endCoords = this.#safeCoordsAtPos(view, range.to);
				if (!startCoords || !endCoords) return null;
				const containerRect = this.#container.getBoundingClientRect();
				return {
					startLeft:
						startCoords.left - containerRect.left - this.config.teardropSize,
					startTop: startCoords.bottom - containerRect.top,
					endLeft: endCoords.left - containerRect.left,
					endTop: endCoords.bottom - containerRect.top,
				};
			},
			write: (data) => {
				if (!data || !this.#selectionActive || !this.#hasSelection()) {
					this.#removeSelectionHandles();
					return;
				}

				this.$start.style.left = `${data.startLeft}px`;
				this.$start.style.top = `${data.startTop}px`;
				this.$end.style.left = `${data.endLeft}px`;
				this.$end.style.top = `${data.endTop}px`;

				if (!this.$start.isConnected) this.#container.append(this.$start);
				if (!this.$end.isConnected) this.#container.append(this.$end);
			},
		});
	}

	#removeSelectionHandles() {
		this.$start.remove();
		this.$end.remove();
	}

	#showCursorHandle() {
		if (
			!this.config.teardropSize ||
			!this.#view.hasFocus ||
			this.#selectionActive
		) {
			this.$cursor.remove();
			return;
		}

		this.#view.requestMeasure({
			read: (view) => {
				const head = view.state.selection.main.head;
				const caret = this.#safeCoordsAtPos(view, head);
				if (!caret) return null;
				const containerRect = this.#container.getBoundingClientRect();
				return {
					left: caret.left - containerRect.left,
					top: caret.bottom - containerRect.top,
				};
			},
			write: (data) => {
				if (!data || this.#selectionActive) {
					this.$cursor.remove();
					return;
				}
				this.$cursor.style.left = `${data.left}px`;
				this.$cursor.style.top = `${data.top}px`;
				if (!this.$cursor.isConnected) this.#container.append(this.$cursor);
				this.#cursorHandleGuardUntil =
					performance.now() + CURSOR_HANDLE_GUARD_MS;
				this.#clearCursorHideTimer();
				this.#cursorHideTimer = setTimeout(() => {
					this.$cursor.remove();
				}, this.config.teardropTimeout);
			},
		});
	}

	#clearCursorHideTimer() {
		clearTimeout(this.#cursorHideTimer);
		this.#cursorHideTimer = null;
	}

	#clearScrollTimeout() {
		clearTimeout(this.#scrollTimeout);
		this.#scrollTimeout = null;
		this.#isScrolling = false;
	}

	#showMenu($trigger) {
		const hasSelection = this.#hasSelection();
		const items = filterSelectionMenuItems(selectionMenu(), {
			readOnly: this.#isReadOnly(),
			hasSelection,
		});

		this.$menu.innerHTML = "";
		if (!items.length) {
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

		const triggerRect = getElementRect($trigger);
		if (!triggerRect) {
			this.#hideMenu(true);
			return;
		}

		const containerRect = this.#container.getBoundingClientRect();
		const initialLeft = triggerRect.left;
		const initialTop = triggerRect.bottom;
		this.$menu.style.left = `${initialLeft - containerRect.left}px`;
		this.$menu.style.top = `${initialTop - containerRect.top}px`;

		const menuRect = this.$menu.getBoundingClientRect();
		const clamped = clampMenuPosition(
			{
				left: menuRect.left,
				top: menuRect.top,
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
		this.#menuActive = true;
	}

	#showMenuDeferred(triggerType = "auto") {
		requestAnimationFrame(() => {
			if (!this.#enabled) return;
			let $trigger = null;
			const normalized =
				triggerType === "auto"
					? this.#hasSelection()
						? "end"
						: "cursor"
					: triggerType;

			if (normalized === "cursor") {
				$trigger = this.$cursor;
				if (!$trigger.isConnected) {
					this.#showCursorHandle();
					requestAnimationFrame(() => {
						if (!this.#enabled || !this.$cursor.isConnected) return;
						this.#showMenu(this.$cursor);
					});
					return;
				}
				this.#showMenu($trigger);
				return;
			}

			$trigger = normalized === "start" ? this.$start : this.$end;
			if (!$trigger.isConnected) {
				this.#showSelectionHandles();
				requestAnimationFrame(() => {
					if (!this.#enabled || !this.#hasSelection()) return;
					const $retryTrigger =
						normalized === "start"
							? this.$start
							: this.$end.isConnected
								? this.$end
								: this.$start;
					if (!$retryTrigger?.isConnected) return;
					this.#showMenu($retryTrigger);
				});
				return;
			}
			this.#showMenu($trigger);
		});
	}

	#hideMenu(force = false, clearActive = true) {
		if (!force && !this.#menuActive && !this.$menu.isConnected) return;
		if (this.$menu.isConnected) {
			this.$menu.remove();
		}
		if (clearActive) {
			this.#menuActive = false;
		}
	}

	#moveCursorToCoords(x, y) {
		const pos = this.#coordsToPos(x, y);
		if (pos == null) return null;
		this.#view.dispatch({
			selection: EditorSelection.cursor(pos),
			scrollIntoView: true,
			userEvent: "select.pointer",
		});
		return pos;
	}

	#coordsToPos(x, y) {
		let pos;
		try {
			pos = this.#view.posAtCoords({ x, y });
		} catch {
			return null;
		}
		if (pos != null) return pos;

		const rect = this.#view.scrollDOM.getBoundingClientRect();
		const cx = clamp(x, rect.left + 1, rect.right - 1);
		const cy = clamp(y, rect.top + 1, rect.bottom - 1);
		try {
			return this.#view.posAtCoords({ x: cx, y: cy });
		} catch {
			return null;
		}
	}

	#selectWordAtCursor() {
		const state = this.#view.state;
		const head = state.selection.main.head;
		this.#selectWordAtPos(head);
	}

	#selectWordAtPos(pos) {
		const state = this.#view.state;
		const colorRange = getColorRange();
		if (colorRange) {
			this.#view.dispatch({
				selection: EditorSelection.range(colorRange.from, colorRange.to),
				scrollIntoView: true,
				userEvent: "select.pointer",
			});
			return;
		}

		const word = state.wordAt(pos);
		if (word) {
			this.#view.dispatch({
				selection: EditorSelection.range(word.from, word.to),
				scrollIntoView: true,
				userEvent: "select.pointer",
			});
			return;
		}

		const line = state.doc.lineAt(pos);
		this.#view.dispatch({
			selection: EditorSelection.range(line.from, line.to),
			scrollIntoView: true,
			userEvent: "select.pointer",
		});
	}

	#selectLineAtCursor() {
		const head = this.#view.state.selection.main.head;
		this.#selectLineAtPos(head);
	}

	#selectLineAtPos(pos) {
		const line = this.#view.state.doc.lineAt(pos);
		this.#view.dispatch({
			selection: EditorSelection.range(line.from, line.to),
			scrollIntoView: true,
			userEvent: "select.pointer",
		});
	}

	#startDrag(type, x, y) {
		this.#clearCursorHideTimer();
		this.#hideMenu();
		const range = this.#view.state.selection.main;
		this.#dragState = {
			type,
			startX: x,
			startY: y,
			moved: false,
			scrollX: 0,
			scrollY: 0,
			fixedPos:
				type === "start" ? range.to : type === "end" ? range.from : null,
		};
		this.#pointer.x = x;
		this.#pointer.y = y;
		this.#addTouchListeners();
	}

	#dragTo(x, y) {
		const state = this.#view.state;
		const range = state.selection.main;
		const lineHeight = this.#view.defaultLineHeight || 20;
		const offsetY = y - lineHeight * DRAG_FINGER_OFFSET_FACTOR;
		let effectiveX = x;
		if (this.#dragState.type === "start") {
			effectiveX += this.config.teardropSize;
		}
		const pos = this.#coordsToPos(effectiveX, offsetY);
		if (pos == null) return;
		const dragDistance = Math.hypot(
			x - this.#dragState.startX,
			y - this.#dragState.startY,
		);
		if (
			!this.#dragState.moved &&
			dragDistance < this.config.touchMoveThreshold
		) {
			return;
		}
		if (!this.#dragState.moved) {
			this.#dragState.moved = true;
		}

		if (this.#dragState.type === "cursor") {
			this.#view.dispatch({
				selection: EditorSelection.cursor(pos),
				scrollIntoView: true,
				userEvent: "select.pointer",
			});
			this.#showCursorHandle();
			return;
		}

		let from = range.from;
		let to = range.to;
		if (this.#dragState.type === "start") {
			to = this.#dragState.fixedPos ?? to;
			const maxFrom = Math.max(0, to - 1);
			from = clamp(pos, 0, maxFrom);
		} else {
			from = this.#dragState.fixedPos ?? from;
			const minTo = Math.min(state.doc.length, from + 1);
			to = clamp(pos, minTo, state.doc.length);
		}

		this.#view.dispatch({
			selection: EditorSelection.range(from, to),
			scrollIntoView: true,
			userEvent: "select.pointer",
		});
		this.#selectionActive = true;
		this.#showSelectionHandles();
		this.#startAutoScrollIfNeeded(x, y);
	}

	#finishDrag() {
		this.#removeTouchListeners();
		this.#stopAutoScroll();
		const dragType = this.#dragState?.type;
		const moved = !!this.#dragState?.moved;
		this.#dragState = null;
		if (dragType === "cursor") {
			this.#showCursorHandle();
			this.#showMenuDeferred("cursor");
		} else {
			this.#showSelectionHandles();
			if (moved || this.#hasSelection()) {
				this.#showMenuDeferred(dragType === "start" ? "start" : "end");
			}
		}
		this.#view.focus();
	}

	#getAutoScrollDelta(x, y) {
		const scroller = this.#view.scrollDOM;
		const rect = scroller.getBoundingClientRect();
		const { horizontal, vertical } = getEdgeScrollDirections({
			x,
			y,
			rect,
			allowHorizontal: !this.#view.lineWrapping,
		});
		const maxScrollLeft = Math.max(
			0,
			scroller.scrollWidth - scroller.clientWidth,
		);
		const maxScrollTop = Math.max(
			0,
			scroller.scrollHeight - scroller.clientHeight,
		);
		let scrollX = horizontal * EDGE_SCROLL_STEP;
		let scrollY = vertical * EDGE_SCROLL_STEP;

		if (
			(scrollX < 0 && scroller.scrollLeft <= 0) ||
			(scrollX > 0 && scroller.scrollLeft >= maxScrollLeft)
		) {
			scrollX = 0;
		}

		if (
			(scrollY < 0 && scroller.scrollTop <= 0) ||
			(scrollY > 0 && scroller.scrollTop >= maxScrollTop)
		) {
			scrollY = 0;
		}

		return { scrollX, scrollY };
	}

	#startAutoScrollIfNeeded(x, y) {
		const { scrollX, scrollY } = this.#getAutoScrollDelta(x, y);
		if (this.#dragState) {
			this.#dragState.scrollX = scrollX;
			this.#dragState.scrollY = scrollY;
		}

		if (!scrollX && !scrollY) {
			this.#stopAutoScroll();
			return;
		}

		if (this.#autoScrollRaf) return;

		const tick = () => {
			if (!this.#dragState) {
				this.#autoScrollRaf = 0;
				return;
			}

			const delta = this.#getAutoScrollDelta(this.#pointer.x, this.#pointer.y);
			this.#dragState.scrollX = delta.scrollX;
			this.#dragState.scrollY = delta.scrollY;
			if (!delta.scrollX && !delta.scrollY) {
				this.#autoScrollRaf = 0;
				return;
			}

			this.#view.scrollDOM.scrollLeft += delta.scrollX;
			this.#view.scrollDOM.scrollTop += delta.scrollY;
			this.#dragTo(this.#pointer.x, this.#pointer.y);
			this.#autoScrollRaf = requestAnimationFrame(tick);
		};

		this.#autoScrollRaf = requestAnimationFrame(tick);
	}

	#stopAutoScroll() {
		cancelAnimationFrame(this.#autoScrollRaf);
		this.#autoScrollRaf = 0;
		if (this.#dragState) {
			this.#dragState.scrollX = 0;
			this.#dragState.scrollY = 0;
		}
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
		// CodeMirror editor surface is contenteditable; do not ignore it.
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

	#clearSelectionUi() {
		this.$cursor.remove();
		this.#removeSelectionHandles();
	}
}
