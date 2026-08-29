import { LSPPlugin } from "@codemirror/lsp-client";
import { EditorSelection } from "@codemirror/state";
import {
	focusEditorIfEditable,
	placeReadOnlyCursor,
	resolveReadOnlyContextSelection,
	shouldCommitReadOnlyTap,
} from "cm/editorReadOnly";
import {
	bindSelectionMenuButton,
	filterSelectionMenuItems,
	partitionSelectionMenuItems,
} from "cm/selectionMenuUtils";
import selectionMenu from "lib/selectionMenu";
import { animate } from "motion";

export { filterSelectionMenuItems } from "cm/selectionMenuUtils";

const TAP_MAX_DELAY = 500;
const TAP_MAX_DISTANCE = 20;
const EDGE_SCROLL_GAP = 40;
const MENU_MARGIN = 10;
const MENU_SHOW_DELAY = 120;
const MENU_CARET_GAP = 10;
const MENU_SELECTION_GAP = 12;
const MENU_HANDLE_CLEARANCE = 28;
const OVERFLOW_GRID_THRESHOLD = 10;
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

/**
 * Add a cursor or range to an existing CodeMirror selection.
 * @param {EditorSelection} selection
 * @param {{anchor:number, head:number, extend?:boolean}} options
 * @returns {EditorSelection}
 */
export function addPointerSelectionRange(selection, options) {
	const { anchor, head, extend = false } = options;
	const range = extend
		? EditorSelection.range(anchor, head)
		: EditorSelection.cursor(head);
	return selection.addRange(range);
}

function clamp(value, min, max) {
	return Math.max(min, Math.min(max, value));
}

function hasCodeActionProvider(view) {
	return LSPPlugin.getAll(view, "codeAction").some(
		(plugin) => !!plugin.client.serverCapabilities?.codeActionProvider,
	);
}

function animationsDisabled() {
	return (
		document.body.classList.contains("no-animation") ||
		globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches
	);
}

export default function createTouchSelectionMenu(view, options = {}) {
	return new TouchSelectionMenuController(view, options);
}

class TouchSelectionMenuController {
	#view;
	#container;
	#getActiveFile;
	#isShiftSelectionActive;
	#isMultiCursorSelectionActive;
	#stateSyncRaf = 0;
	#isScrolling = false;
	#isPointerInteracting = false;
	#pointerSelectionSession = null;
	#readOnlyTapSession = null;
	#pendingPointerSelectionClick = null;
	#menuActive = false;
	#menuRequested = false;
	#enabled = true;
	#handlingMenuAction = false;
	#menuShowTimer = null;
	#tooltipObserver = null;
	#dismissedSelection = null;
	#renderedMenuKey = "";
	#menuAnchor = null;
	#menuAnimation = null;
	#viewAnimations = [];
	#overflowExpanded = false;

	constructor(view, options = {}) {
		this.#view = view;
		this.#container =
			options.container || view.dom.closest(".editor-container") || view.dom;
		this.#getActiveFile = options.getActiveFile || (() => null);
		this.#isShiftSelectionActive =
			options.isShiftSelectionActive || (() => false);
		this.#isMultiCursorSelectionActive =
			options.isMultiCursorSelectionActive || (() => false);
		this.$menu = document.createElement("menu");
		this.$menu.className = "cursor-menu";
		this.#bindEvents();
	}

	#bindEvents() {
		const root = this.#view.dom;
		root.addEventListener("contextmenu", this.#onContextMenu, true);
		document.addEventListener("pointerdown", this.#onGlobalPointerDown, true);
		document.addEventListener("pointermove", this.#onGlobalPointerMove, true);
		document.addEventListener("pointerup", this.#onGlobalPointerUp, true);
		document.addEventListener("pointercancel", this.#onGlobalPointerUp, true);

		this.#tooltipObserver = new MutationObserver((mutations) => {
			const relevant = mutations.some((m) =>
				[...m.addedNodes, ...m.removedNodes].some(
					(n) =>
						n.nodeType === 1 &&
						(n.matches?.(".cm-tooltip") || n.querySelector?.(".cm-tooltip")),
				),
			);
			if (!relevant || !this.#menuActive || !this.#shouldShowMenu()) {
				return;
			}
			this.#showMenuDeferred();
		});
		this.#tooltipObserver.observe(this.#view.dom, {
			childList: true,
			subtree: true,
		});
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
			"pointermove",
			this.#onGlobalPointerMove,
			true,
		);
		document.removeEventListener(
			"pointercancel",
			this.#onGlobalPointerUp,
			true,
		);
		this.#clearMenuShowTimer();
		cancelAnimationFrame(this.#stateSyncRaf);
		this.#stateSyncRaf = 0;
		this.#pointerSelectionSession = null;
		this.#readOnlyTapSession = null;
		this.#pendingPointerSelectionClick = null;
		this.#tooltipObserver?.disconnect();
		this.#hideMenu(true);
	}

	setEnabled(enabled) {
		this.#enabled = !!enabled;
		if (this.#enabled) return;
		this.#pointerSelectionSession = null;
		this.#readOnlyTapSession = null;
		this.#pendingPointerSelectionClick = null;
		this.#dismissedSelection = null;
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
			this.#dismissedSelection = null;
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
		this.#dismissedSelection = null;
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
		this.#cancelReadOnlyTap();
		this.#hideMenu();
	}

	onScrollEnd() {
		if (!this.#enabled || !this.#isScrolling) return;
		this.#isScrolling = false;
		if (this.#shouldShowMenu()) this.#scheduleMenuShow(MENU_SHOW_DELAY);
	}

	onStateChanged(meta = {}) {
		if (!this.#enabled) return;
		if (meta.selectionChanged) this.#cancelReadOnlyTap();
		if (
			meta.selectionChanged &&
			this.#dismissedSelection !== this.#selectionSignature()
		) {
			this.#dismissedSelection = null;
		}
		if (this.#handlingMenuAction) return;
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
		this.#pointerSelectionSession = null;
		this.#readOnlyTapSession = null;
		this.#pendingPointerSelectionClick = null;
		this.#dismissedSelection = null;
		this.#menuRequested = false;
		this.#isPointerInteracting = false;
		this.#isScrolling = false;
		this.#clearMenuShowTimer();
		this.#hideMenu(true);
	}

	#onContextMenu = (event) => {
		if (!this.#enabled) return;
		if (this.#isIgnoredPointerTarget(event.target)) return;
		this.#cancelReadOnlyTap();
		if (this.#isReadOnly()) {
			const pos = this.#safePosAtCoords(event.clientX, event.clientY);
			if (pos != null) {
				const range = resolveReadOnlyContextSelection(this.#view.state, pos);
				this.#view.dispatch({
					selection: EditorSelection.create([range]),
					userEvent: "select.pointer",
				});
			}
		}
		event.preventDefault();
		event.stopPropagation();
		this.#dismissedSelection = null;
		this.#menuRequested = true;
		this.#scheduleMenuShow(MENU_SHOW_DELAY);
	};

	#onGlobalPointerDown = (event) => {
		const target = event.target;
		if (this.$menu.contains(target)) {
			this.#readOnlyTapSession = null;
			return;
		}
		if (this.#isIgnoredPointerTarget(target)) {
			this.#pointerSelectionSession = null;
			this.#readOnlyTapSession = null;
			return;
		}
		if (target instanceof Node && this.#view.dom.contains(target)) {
			this.#dismissedSelection = null;
			this.#capturePointerSelection(event);
			this.#captureReadOnlyTap(event);
			this.#isPointerInteracting = true;
			this.#clearMenuShowTimer();
			return;
		}
		this.#pointerSelectionSession = null;
		this.#readOnlyTapSession = null;
		this.#isPointerInteracting = false;
		this.#menuRequested = false;
		this.#hideMenu();
	};

	#onGlobalPointerMove = (event) => {
		const session = this.#readOnlyTapSession;
		if (!session || session.pointerId !== event.pointerId) return;
		if (
			Math.hypot(event.clientX - session.x, event.clientY - session.y) >
			TAP_MAX_DISTANCE
		) {
			this.#cancelReadOnlyTap();
		}
	};

	#onGlobalPointerUp = (event) => {
		if (event.type === "pointerup") {
			this.#commitPointerSelection(event);
			this.#commitReadOnlyTap(event);
		} else {
			this.#pointerSelectionSession = null;
			this.#readOnlyTapSession = null;
		}
		if (!this.#isPointerInteracting) return;
		this.#isPointerInteracting = false;
		if (!this.#enabled) return;
		if (this.#shouldShowMenu()) {
			this.#scheduleMenuShow(0);
			return;
		}
		if (!this.#hasSelection()) {
			this.#menuRequested = false;
		}
		this.#hideMenu();
	};

	#captureReadOnlyTap(event) {
		this.#readOnlyTapSession = null;
		if (!this.#enabled || !this.#isReadOnly()) return;
		if (!(event.isTrusted && event.isPrimary)) return;
		if (typeof event.button === "number" && event.button !== 0) return;
		if (this.#canExtendSelection(event) || this.#canAddSelectionRange(event)) {
			return;
		}

		this.#readOnlyTapSession = {
			pointerId: event.pointerId,
			x: event.clientX,
			y: event.clientY,
			timeStamp: event.timeStamp,
			isPrimary: event.isPrimary,
			button: event.button,
			selection: this.#view.state.selection,
			cancelled: false,
		};
	}

	#cancelReadOnlyTap() {
		if (this.#readOnlyTapSession) {
			this.#readOnlyTapSession.cancelled = true;
		}
	}

	#commitReadOnlyTap(event) {
		const session = this.#readOnlyTapSession;
		this.#readOnlyTapSession = null;
		if (!session || !this.#enabled || !this.#isReadOnly()) return false;
		if (!this.#view.state.selection.eq(session.selection)) return false;
		if (
			!shouldCommitReadOnlyTap(
				session,
				{
					pointerId: event.pointerId,
					x: event.clientX,
					y: event.clientY,
					timeStamp: event.timeStamp,
					isPrimary: event.isPrimary,
					button: event.button,
				},
				{ maxDelay: TAP_MAX_DELAY, maxDistance: TAP_MAX_DISTANCE },
			)
		) {
			return false;
		}
		const target = event.target;
		if (!(target instanceof Node) || !this.#view.dom.contains(target)) {
			return false;
		}
		if (this.#isIgnoredPointerTarget(target)) return false;

		const pos = this.#safePosAtCoords(event.clientX, event.clientY);
		if (pos == null) return false;
		if (!placeReadOnlyCursor(this.#view, pos)) return false;
		this.#menuRequested = false;
		this.#clearMenuShowTimer();
		this.#hideMenu(true);
		try {
			document.getSelection()?.removeAllRanges();
		} catch (error) {
			console.warn("Failed to clear native read-only selection.", error);
		}
		event.preventDefault();
		focusEditorIfEditable(this.#view);
		return true;
	}

	#capturePointerSelection(event) {
		if (!this.#canHandlePointerSelection(event)) {
			this.#pointerSelectionSession = null;
			return;
		}

		this.#pointerSelectionSession = {
			pointerId: event.pointerId,
			anchor: this.#view.state.selection.main.anchor,
			extend: this.#canExtendSelection(event),
			addRange: this.#canAddSelectionRange(event),
			x: event.clientX,
			y: event.clientY,
		};
	}

	#commitPointerSelection(event) {
		const session = this.#pointerSelectionSession;
		this.#pointerSelectionSession = null;
		if (!session) return;
		if (!this.#canHandlePointerSelection(event)) return;
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
		if (head == null) return;
		const selection = session.addRange
			? addPointerSelectionRange(this.#view.state.selection, {
					anchor: session.anchor,
					head,
					extend: session.extend,
				})
			: EditorSelection.range(session.anchor, head);
		this.#view.dispatch({
			selection,
			userEvent: session.addRange ? "select.pointer" : "select.extend",
		});
		this.#pendingPointerSelectionClick = {
			x: event.clientX,
			y: event.clientY,
			timeStamp: event.timeStamp,
		};
		event.preventDefault();
	}

	#canHandlePointerSelection(event) {
		return this.#canExtendSelection(event) || this.#canAddSelectionRange(event);
	}

	#canExtendSelection(event) {
		if (!this.#enabled) return false;
		if (!(event.isTrusted && event.isPrimary)) return false;
		if (typeof event.button === "number" && event.button !== 0) return false;
		return !!this.#isShiftSelectionActive(event);
	}

	#canAddSelectionRange(event) {
		if (!this.#enabled) return false;
		if (!(event.isTrusted && event.isPrimary)) return false;
		if (typeof event.button === "number" && event.button !== 0) return false;
		return !!this.#isMultiCursorSelectionActive(event);
	}

	consumePendingShiftSelectionClick(event) {
		const pending = this.#pendingPointerSelectionClick;
		this.#pendingPointerSelectionClick = null;
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
		if (this.#isScrolling || this.#isPointerInteracting) return false;
		if (!this.#view.hasFocus && !this.#isReadOnly()) return false;
		if (
			!this.#menuRequested &&
			this.#dismissedSelection === this.#selectionSignature()
		) {
			return false;
		}
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

	#safePosAtCoords(x, y) {
		try {
			return this.#view.posAtCoords({ x, y }, false);
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
		this.#menuAnchor = anchor;
		const hasSelection = this.#hasSelection();
		const items = filterSelectionMenuItems(
			selectionMenu({
				codeActionsAvailable: hasCodeActionProvider(this.#view),
			}),
			{
				readOnly: this.#isReadOnly(),
				hasSelection,
			},
		);

		if (!items.length) {
			this.#menuRequested = false;
			this.#hideMenu(true);
			return;
		}

		const menuKey = `${hasSelection}:${items
			.map((item) => item.id || this.#getItemLabel(item))
			.join("|")}`;
		const menuChanged = menuKey !== this.#renderedMenuKey;
		if (menuChanged) {
			const groups = partitionSelectionMenuItems(items, { hasSelection });
			this.#renderMenu(groups.primary, groups.overflow);
			this.#renderedMenuKey = menuKey;
		}

		if (!this.$menu.isConnected) {
			this.#container.append(this.$menu);
		}
		this.$menu.style.removeProperty("width");
		this.$menu.style.removeProperty("height");
		const isOpening = !this.#menuActive;
		this.#positionMenu(anchor);
		this.#menuActive = true;
		this.#menuRequested = false;
		if (isOpening) this.#animateMenuIn();
	}

	#renderMenu(primaryItems, overflowItems) {
		for (const animation of this.#viewAnimations) animation.cancel?.();
		this.#viewAnimations = [];
		this.#overflowExpanded = false;
		this.$menu.style.removeProperty("width");
		this.$menu.style.removeProperty("height");
		this.$menu.replaceChildren();
		this.$menu.setAttribute("aria-label", "Text selection actions");

		const $primary = document.createElement("div");
		$primary.className = "cursor-menu__primary";
		$primary.setAttribute("role", "toolbar");
		for (const item of primaryItems) {
			$primary.append(this.#createActionButton(item, false));
		}

		if (overflowItems.length) {
			const $overflow = document.createElement("div");
			$overflow.className = "cursor-menu__overflow";
			if (overflowItems.length > OVERFLOW_GRID_THRESHOLD) {
				$overflow.classList.add("cursor-menu__overflow--grid");
			}
			$overflow.setAttribute("role", "toolbar");
			$overflow.setAttribute("aria-label", "More text actions");
			$overflow.hidden = true;

			const backLabel = globalThis.strings?.back || "Back";
			const $back = document.createElement("button");
			$back.type = "button";
			$back.className = "cursor-menu__action cursor-menu__back";
			$back.setAttribute("aria-label", backLabel);
			$back.append(this.#createIcon("arrow_back"));

			const $overflowActions = document.createElement("div");
			$overflowActions.className = "cursor-menu__overflow-actions";
			for (const item of overflowItems) {
				$overflowActions.append(this.#createActionButton(item, true));
			}
			$overflow.append($back, $overflowActions);

			const moreLabel = globalThis.strings?.more || "More";
			const $more = document.createElement("button");
			$more.type = "button";
			$more.className = "cursor-menu__action cursor-menu__more";
			$more.setAttribute("aria-label", moreLabel);
			$more.setAttribute("aria-expanded", "false");
			$more.append(this.#createIcon("keyboard_control"));
			bindSelectionMenuButton($more, () => {
				$more.setAttribute("aria-expanded", "true");
				this.#setOverflowExpanded($primary, $overflow, true);
			});
			bindSelectionMenuButton($back, () => {
				$more.setAttribute("aria-expanded", "false");
				this.#setOverflowExpanded($primary, $overflow, false);
			});

			$primary.append($more);
			this.$menu.append($primary, $overflow);
			return;
		}

		this.$menu.append($primary);
	}

	#createActionButton(item, isOverflow) {
		const $item = document.createElement("button");
		const label = this.#getItemLabel(item);
		$item.type = "button";
		$item.className = `cursor-menu__action${
			isOverflow ? " cursor-menu__overflow-action" : ""
		}`;
		$item.setAttribute("aria-label", label);
		if (label !== "More action") $item.title = label;

		if (isOverflow) {
			if (item.text instanceof Node) {
				$item.append(item.text.cloneNode(true));
			} else {
				$item.textContent = label;
			}
		} else if (item.text instanceof Node) {
			$item.append(item.text.cloneNode(true));
		} else {
			$item.textContent = label;
		}

		let handled = false;
		const runAction = (event) => {
			if (handled) return;
			handled = true;
			event.preventDefault();
			event.stopPropagation();
			this.#clearMenuShowTimer();
			cancelAnimationFrame(this.#stateSyncRaf);
			this.#stateSyncRaf = 0;
			this.#handlingMenuAction = true;
			try {
				item.onclick?.();
			} finally {
				this.#handlingMenuAction = false;
				this.#menuRequested = false;
				this.#dismissedSelection = this.#selectionSignature();
				this.#hideMenu();
				focusEditorIfEditable(this.#view);
			}
		};
		bindSelectionMenuButton($item, runAction);
		return $item;
	}

	#animateMenuIn() {
		this.#menuAnimation?.cancel?.();
		if (animationsDisabled()) {
			this.$menu.style.opacity = "1";
			this.$menu.style.transform = "none";
			return;
		}

		const y = this.$menu.dataset.placement === "above" ? 3 : -3;
		this.#menuAnimation = animate(
			this.$menu,
			{
				opacity: [0, 1],
				scale: [0.96, 1],
				y: [y, 0],
			},
			{ duration: 0.14, ease: "easeOut" },
		);
	}

	#setOverflowExpanded($primary, $overflow, expanded) {
		if (expanded === this.#overflowExpanded) return;
		const initialRect = this.$menu.getBoundingClientRect();
		this.#menuAnimation?.cancel?.();
		this.#menuAnimation = null;
		for (const animation of this.#viewAnimations) animation.cancel?.();
		this.#viewAnimations = [];
		$primary.hidden = this.#overflowExpanded;
		$overflow.hidden = !this.#overflowExpanded;
		const outgoing = this.#overflowExpanded ? $overflow : $primary;
		const incoming = expanded ? $overflow : $primary;
		const direction = expanded ? 1 : -1;
		for (const $view of [$primary, $overflow]) {
			$view.style.opacity = "";
			$view.style.transform = "";
			$view.style.visibility = "";
			$view.style.position = "";
			$view.style.inset = "";
			$view.style.pointerEvents = "";
			$view.style.transformOrigin = "";
		}
		this.#overflowExpanded = expanded;
		outgoing.style.position = "absolute";
		outgoing.style.inset = "0 auto auto 0";
		outgoing.style.pointerEvents = "none";
		incoming.hidden = false;
		this.$menu.style.removeProperty("width");
		this.$menu.style.removeProperty("height");
		this.$menu.style.transform = "";
		if (this.#menuAnchor) this.#positionMenu(this.#menuAnchor);
		const finalRect = this.$menu.getBoundingClientRect();
		const menuScaleX = finalRect.width
			? initialRect.width / finalRect.width
			: 1;
		const menuScaleY = finalRect.height
			? initialRect.height / finalRect.height
			: 1;
		const viewScaleX = menuScaleX ? 1 / menuScaleX : 1;
		const viewScaleY = menuScaleY ? 1 / menuScaleY : 1;
		this.$menu.style.transformOrigin = "left top";
		for (const $view of [outgoing, incoming]) {
			$view.style.transformOrigin = "left top";
		}

		const clearMenuGeometry = () => {
			this.$menu.style.removeProperty("width");
			this.$menu.style.removeProperty("height");
			this.$menu.style.transform = "";
			this.$menu.style.transformOrigin = "";
		};
		const finish = () => {
			outgoing.hidden = true;
			for (const $view of [$primary, $overflow]) {
				$view.style.opacity = "";
				$view.style.transform = "";
				$view.style.position = "";
				$view.style.inset = "";
				$view.style.pointerEvents = "";
				$view.style.transformOrigin = "";
			}
			clearMenuGeometry();
			this.#viewAnimations = [];
		};

		if (animationsDisabled()) {
			finish();
			return;
		}
		const outgoingAnimation = animate(
			outgoing,
			{
				opacity: [1, 0],
				x: [0, -6 * direction],
				scaleX: [viewScaleX, 1],
				scaleY: [viewScaleY, 1],
			},
			{ duration: 0.12, ease: "easeIn" },
		);
		const incomingAnimation = animate(
			incoming,
			{
				opacity: [0, 1],
				x: [6 * direction, 0],
				scaleX: [viewScaleX, 1],
				scaleY: [viewScaleY, 1],
			},
			{ duration: 0.18, ease: "easeOut" },
		);
		const animations = [outgoingAnimation, incomingAnimation];
		if (
			initialRect.width !== finalRect.width ||
			initialRect.height !== finalRect.height ||
			initialRect.left !== finalRect.left ||
			initialRect.top !== finalRect.top
		) {
			animations.push(
				animate(
					this.$menu,
					{
						x: [initialRect.left - finalRect.left, 0],
						y: [initialRect.top - finalRect.top, 0],
						scaleX: [menuScaleX, 1],
						scaleY: [menuScaleY, 1],
					},
					{
						duration: 0.18,
						ease: [0.2, 0, 0, 1],
						onComplete: clearMenuGeometry,
					},
				),
			);
		}
		this.#viewAnimations = animations;
		Promise.allSettled(
			animations.map((animation) => animation.finished ?? animation),
		).then(() => {
			if (this.#viewAnimations !== animations) return;
			finish();
		});
	}

	#positionMenu(anchor) {
		if (!this.$menu.isConnected) return;

		const containerRect = this.#container.getBoundingClientRect();
		this.$menu.style.setProperty(
			"--cursor-menu-max-width",
			`${Math.max(0, containerRect.width - MENU_MARGIN * 2)}px`,
		);
		this.$menu.style.setProperty(
			"--cursor-menu-grid-max-height",
			`${Math.max(40, Math.min(240, containerRect.height - MENU_MARGIN * 2))}px`,
		);
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
		const placedAbove = fitsAbove || !fitsBelow;
		const clamped = clampMenuPosition(
			{
				left: preferredLeft,
				top: placedAbove ? topAbove : topBelow,
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

		this.#avoidTooltips(containerRect, clamped, menuRect);

		this.$menu.style.left = `${clamped.left - containerRect.left}px`;
		this.$menu.style.top = `${clamped.top - containerRect.top}px`;
		this.$menu.dataset.placement = placedAbove ? "above" : "below";
		this.$menu.style.visibility = "";
	}

	#getItemLabel(item) {
		if (item.label) return item.label;
		if (typeof item.text === "string" && item.text.trim()) return item.text;
		if (item.text instanceof Element) {
			return (
				item.text.getAttribute("aria-label") ||
				item.text.getAttribute("title") ||
				item.text.textContent?.trim() ||
				"More action"
			);
		}
		return "More action";
	}

	#createIcon(name) {
		const $icon = document.createElement("span");
		$icon.className = `icon ${name}`;
		$icon.setAttribute("aria-hidden", "true");
		return $icon;
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

	#avoidTooltips(containerRect, clamped, menuRect) {
		const tooltips = this.#view.dom.querySelectorAll(".cm-tooltip");
		if (!tooltips.length) return;

		const menuBox = {
			left: clamped.left,
			top: clamped.top,
			right: clamped.left + menuRect.width,
			bottom: clamped.top + menuRect.height,
		};

		for (const tooltip of tooltips) {
			if (!tooltip.isConnected) continue;
			const r = tooltip.getBoundingClientRect();
			if (r.width === 0 && r.height === 0) continue;
			if (
				menuBox.right <= r.left ||
				menuBox.left >= r.right ||
				menuBox.bottom <= r.top ||
				menuBox.top >= r.bottom
			) {
				continue;
			}

			const tryAbove = r.top - MENU_MARGIN - menuRect.height;
			const tryBelow = r.bottom + MENU_MARGIN;
			const maxTop =
				containerRect.top +
				containerRect.height -
				menuRect.height -
				MENU_MARGIN;
			const minTop = containerRect.top + MENU_MARGIN;

			if (tryAbove >= minTop) {
				clamped.top = tryAbove;
			} else if (tryBelow <= maxTop) {
				clamped.top = Math.min(tryBelow, maxTop);
			}

			if (clamped.top < minTop) clamped.top = minTop;
			if (clamped.top > maxTop) clamped.top = maxTop;

			menuBox.top = clamped.top;
			menuBox.bottom = clamped.top + menuRect.height;
		}
	}

	#hideMenu(force = false) {
		if (!force && !this.#menuActive && !this.$menu.isConnected) return;
		this.#menuAnimation?.cancel?.();
		for (const animation of this.#viewAnimations) animation.cancel?.();
		this.#menuAnimation = null;
		this.#viewAnimations = [];
		if (this.$menu.isConnected) {
			this.$menu.remove();
		}
		const overflow = this.$menu.querySelector(".cursor-menu__overflow");
		if (overflow) overflow.hidden = true;
		if (overflow) {
			overflow.style.opacity = "";
			overflow.style.transform = "";
			overflow.style.pointerEvents = "";
			overflow.style.position = "";
			overflow.style.inset = "";
			overflow.style.transformOrigin = "";
		}
		const primary = this.$menu.querySelector(".cursor-menu__primary");
		if (primary) {
			primary.hidden = false;
			primary.style.opacity = "";
			primary.style.transform = "";
			primary.style.pointerEvents = "";
			primary.style.position = "";
			primary.style.inset = "";
			primary.style.transformOrigin = "";
		}
		this.$menu.style.opacity = "";
		this.$menu.style.transform = "";
		this.$menu.style.transformOrigin = "";
		this.$menu.style.removeProperty("width");
		this.$menu.style.removeProperty("height");
		this.$menu
			.querySelector(".cursor-menu__more")
			?.setAttribute("aria-expanded", "false");
		this.#renderedMenuKey = "";
		this.#overflowExpanded = false;
		this.#menuAnchor = null;
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

	#selectionSignature() {
		return this.#view.state.selection.ranges
			.map((range) => `${range.anchor}:${range.head}`)
			.join("|");
	}
}
