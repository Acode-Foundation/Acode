import "./dragMove.scss";
import tag from "html-tag-js";
import config from "lib/config";
import appSettings from "lib/settings";
import selection from "./selection";

// Movement allowed before a touch counts as a scroll instead of a press.
const TOUCH_SLOP = 8;
// After a long press a resting finger still wobbles, so a drag needs a
// clearly deliberate move.
const DRAG_SLOP = 14;
const MOUSE_SLOP = 5;
// Holding still this long after the long press opens the menu without
// waiting for the finger to lift.
const MENU_HOLD_MS = 300;
// Distance from a scroll edge where the list starts scrolling on its own.
const SCROLL_EDGE = 48;
const MAX_SCROLL_SPEED = 14;
// Hovering a closed folder this long opens it.
const SPRING_OPEN_MS = 650;
// Fraction of the remaining distance the preview covers each frame.
const FOLLOW = 0.35;
const SETTLE_MS = 240;

/** @type {HTMLElement} */
let container;
/**
 * Press that may turn into a drag.
 * @type {{$tile: HTMLElement, x: number, y: number, pointer: "touch"|"mouse", armed: boolean, menuOpened?: boolean, menuTimer?: number, $target?: Element, $touchTarget?: EventTarget} | null}
 */
let press = null;
/** @type {DragState|null} */
let drag = null;
let suppressClick = false;
/** Context menu events re-dispatched after a long press ends without moving. */
const replayed = new WeakSet();
/** Touch events already handled, since they can reach two listeners. */
const handled = new WeakSet();

/**
 * @typedef {object} DragState
 * @property {import("./selection").SelectedEntry[]} items
 * @property {HTMLElement[]} $sources
 * @property {HTMLElement} $ghost
 * @property {DOMRect} origin
 * @property {"touch"|"mouse"} pointer
 * @property {number} x Pointer position
 * @property {number} y
 * @property {number} gx Preview position
 * @property {number} gy
 * @property {number} tilt
 * @property {HTMLElement|null} $list Folder the entries would drop into
 * @property {HTMLElement|null} $scroller
 * @property {number} raf
 * @property {number} springTimer
 */

/**
 * Let entries in the files sidebar be dragged onto folders.
 * Must run before the selection handlers so a long press can become a drag.
 * @param {HTMLElement} $container
 */
function init($container) {
	container = $container;
	container.addEventListener("touchstart", onTouchStart, {
		capture: true,
		passive: true,
	});
	container.addEventListener("mousedown", onMouseDown, true);
	container.addEventListener("contextmenu", onContextMenu, true);
	container.addEventListener("click", onClick, true);
}

/**
 * @param {TouchEvent} e
 */
function onTouchStart(e) {
	// A drag that lost its touch stream ends with the next touch.
	if (drag) finishDrag(false);
	endPress();
	if (e.touches.length !== 1) {
		endPress();
		return;
	}

	const $tile = selection.getEntry(e.target);
	if (!$tile) return;

	const { clientX, clientY } = e.touches[0];
	press = {
		$tile,
		x: clientX,
		y: clientY,
		pointer: "touch",
		armed: false,
		$touchTarget: e.target,
	};
	// Touch events keep going to the touched element even after it leaves the
	// DOM (e.g. its folder collapses mid-drag), where they no longer reach the
	// window, so listen on both.
	for (const $el of [window, e.target]) {
		$el.addEventListener("touchmove", onTouchMove, {
			capture: true,
			passive: false,
		});
		$el.addEventListener("touchend", onTouchEnd, true);
		$el.addEventListener("touchcancel", onTouchCancel, true);
	}
}

/**
 * @param {TouchEvent} e
 */
function onTouchMove(e) {
	if (isHandled(e)) return;
	const touch = e.touches[0];
	if (!touch) return;

	if (drag) {
		consume(e);
		moveDrag(touch.clientX, touch.clientY);
		return;
	}

	if (!press) return;

	if (!press.armed) {
		// Moving before the long press is a scroll.
		if (distance(press, touch) > TOUCH_SLOP) endPress();
		return;
	}

	// Held long enough: keep the list (and the sidebar) still.
	consume(e);
	if (press.menuOpened) return;
	if (distance(press, touch) > DRAG_SLOP) {
		clearTimeout(press.menuTimer);
		startDrag(touch.clientX, touch.clientY);
	}
}

/**
 * @param {TouchEvent} e
 */
function onTouchEnd(e) {
	if (isHandled(e)) return;
	if (drag) {
		const touch = e.changedTouches[0];
		if (touch) moveDrag(touch.clientX, touch.clientY);
		finishDrag(true);
		endPress();
		return;
	}

	// A long press released in place is a normal context menu request.
	if (press?.armed && !press.menuOpened) replayContextMenu(press);
	endPress();
}

function onTouchCancel(e) {
	if (isHandled(e)) return;
	if (drag) finishDrag(false);
	endPress();
}

/**
 * Hold the long-press context menu until it's clear whether this is a drag.
 * @param {MouseEvent} e
 */
function onContextMenu(e) {
	if (replayed.has(e)) return;
	if (press?.pointer !== "touch" || press.armed) return;
	if (selection.getEntry(e.target) !== press.$tile) return;

	consume(e);
	press.armed = true;
	press.$target = e.target;
	press.$tile.classList.add("drag-armed");
	vibrate();

	// Holding still means the menu was wanted, not a drag.
	const current = press;
	current.menuTimer = setTimeout(() => {
		if (press !== current || drag) return;
		current.menuOpened = true;
		current.$tile.classList.remove("drag-armed");
		replayContextMenu(current);
	}, MENU_HOLD_MS);
}

/**
 * @param {MouseEvent} e
 */
function onMouseDown(e) {
	suppressClick = false;
	if (drag || e.button !== 0) return;

	const $tile = selection.getEntry(e.target);
	if (!$tile) return;

	press = {
		$tile,
		x: e.clientX,
		y: e.clientY,
		pointer: "mouse",
		armed: true,
	};
	window.addEventListener("mousemove", onMouseMove, true);
	window.addEventListener("mouseup", onMouseUp, true);
}

/**
 * @param {MouseEvent} e
 */
function onMouseMove(e) {
	if (drag) {
		e.preventDefault();
		moveDrag(e.clientX, e.clientY);
		return;
	}

	if (press && distance(press, e) > MOUSE_SLOP) {
		e.preventDefault();
		startDrag(e.clientX, e.clientY);
	}
}

function onMouseUp() {
	if (drag) {
		// The click that follows mouseup must not open or toggle the entry.
		suppressClick = true;
		finishDrag(true);
	}
	endPress();
}

/**
 * @param {MouseEvent} e
 */
function onClick(e) {
	if (!suppressClick) return;
	suppressClick = false;
	consume(e);
}

/**
 * @param {KeyboardEvent} e
 */
function onKeydown(e) {
	if (e.key === "Escape" && drag) {
		finishDrag(false);
		endPress();
	}
}

/**
 * Any new touch during a drag means its own touch stream was lost.
 */
function onStrayTouch() {
	if (drag) finishDrag(false);
	endPress();
}

/**
 * @param {number} x
 * @param {number} y
 */
function startDrag(x, y) {
	const { $tile, pointer } = press;
	const { url, type, name } = $tile.dataset;

	// Dragging a selected entry carries the whole selection along.
	const items = selection.isSelected(url)
		? selection.getItems()
		: [{ url, type, name, $el: $tile }];
	const $sources = items.flatMap(({ url }) => findTiles(url));
	const origin = $tile.getBoundingClientRect();

	$tile.classList.remove("drag-armed");
	for (const $el of $sources) $el.classList.add("drag-source");
	document.body.classList.add("file-dragging");
	document.addEventListener("keydown", onKeydown, true);
	document.addEventListener("touchstart", onStrayTouch, true);

	drag = {
		items,
		$sources,
		$ghost: createGhost($tile, items),
		origin,
		pointer,
		x,
		y,
		gx: origin.left,
		gy: origin.top,
		tilt: 0,
		$list: null,
		$scroller: null,
		raf: 0,
		springTimer: 0,
	};

	vibrate();
	updateTarget();
	drag.raf = requestAnimationFrame(frame);
}

/**
 * @param {number} x
 * @param {number} y
 */
function moveDrag(x, y) {
	drag.x = x;
	drag.y = y;
	updateTarget();
}

/**
 * Ease the preview toward the pointer, tilting slightly with its motion,
 * and scroll the list when the pointer nears an edge.
 */
function frame() {
	if (!drag) return;

	// Keep the preview clear of the finger; beside the cursor for mice.
	const isTouch = drag.pointer === "touch";
	const targetX = drag.x + (isTouch ? 16 : 14);
	const targetY = drag.y + (isTouch ? -52 : 10);
	const dx = targetX - drag.gx;

	drag.gx += dx * FOLLOW;
	drag.gy += (targetY - drag.gy) * FOLLOW;
	drag.tilt += (clamp(dx * 0.12, -6, 6) - drag.tilt) * 0.2;
	drag.$ghost.style.transform = `translate3d(${drag.gx}px, ${drag.gy}px, 0) rotate(${drag.tilt}deg)`;

	autoScroll();
	drag.raf = requestAnimationFrame(frame);
}

function autoScroll() {
	const $scroller = drag.$scroller;
	if (!$scroller) return;

	const { top, bottom } = $scroller.getBoundingClientRect();
	let speed = 0;
	if (drag.y < top + SCROLL_EDGE) {
		speed =
			-MAX_SCROLL_SPEED *
			Math.min(1, (top + SCROLL_EDGE - drag.y) / SCROLL_EDGE);
	} else if (drag.y > bottom - SCROLL_EDGE) {
		speed =
			MAX_SCROLL_SPEED *
			Math.min(1, (drag.y - bottom + SCROLL_EDGE) / SCROLL_EDGE);
	}
	if (!speed) return;

	const before = $scroller.scrollTop;
	$scroller.scrollTop += speed;
	if ($scroller.scrollTop !== before) updateTarget();
}

/**
 * Find the folder under the pointer and highlight it if it can take the drop.
 */
function updateTarget() {
	const $el = document.elementFromPoint(drag.x, drag.y);
	const $scroller = getScroller($el);
	if ($scroller) drag.$scroller = $scroller;

	let $list = getDropList($el);
	if ($list && !canDropInto($list)) $list = null;
	if ($list === drag.$list) return;

	clearTarget();
	drag.$list = $list;
	if (!$list) return;

	$list.classList.add("drop-target");

	// Spring-loaded folders: hovering a closed one opens it.
	if (
		$list.classList.contains("hidden") &&
		typeof $list.expand === "function"
	) {
		$list.classList.add("drop-pending");
		drag.springTimer = setTimeout(() => {
			$list.classList.remove("drop-pending");
			if (drag?.$list === $list) $list.expand();
		}, SPRING_OPEN_MS);
	}
}

function clearTarget() {
	clearTimeout(drag.springTimer);
	drag.$list?.classList.remove("drop-target", "drop-pending");
}

/**
 * @param {boolean} drop Whether to move the entries into the hovered folder
 */
function finishDrag(drop) {
	const state = drag;
	drag = null;
	cancelAnimationFrame(state.raf);
	clearTimeout(state.springTimer);
	state.$list?.classList.remove("drop-target", "drop-pending");
	document.body.classList.remove("file-dragging");
	document.removeEventListener("keydown", onKeydown, true);
	document.removeEventListener("touchstart", onStrayTouch, true);
	for (const $el of state.$sources) $el.classList.remove("drag-source");

	const $ghost = state.$ghost;
	const $title = drop ? state.$list?.firstElementChild : null;
	const targetUrl = $title?.dataset.url;
	$ghost.classList.add("settling");

	if (targetUrl) {
		// Shrink into the folder it was dropped on.
		const rect = $title.getBoundingClientRect();
		const y = rect.top + rect.height / 2 - $ghost.offsetHeight / 2;
		$ghost.style.transform = `translate3d(${rect.left + 12}px, ${y}px, 0) scale(0.3)`;
		$title.classList.add("drop-flash");
		setTimeout(() => $title.classList.remove("drop-flash"), 600);
		vibrate();
		selection.perform("move", state.items, targetUrl);
	} else {
		// Nowhere to drop: return to where it came from.
		const { left, top } = state.origin;
		$ghost.style.transform = `translate3d(${left}px, ${top}px, 0)`;
	}

	setTimeout(() => $ghost.remove(), SETTLE_MS);
}

function endPress() {
	clearTimeout(press?.menuTimer);
	press?.$tile.classList.remove("drag-armed");
	for (const $el of [window, press?.$touchTarget]) {
		$el?.removeEventListener("touchmove", onTouchMove, true);
		$el?.removeEventListener("touchend", onTouchEnd, true);
		$el?.removeEventListener("touchcancel", onTouchCancel, true);
	}
	press = null;
	window.removeEventListener("mousemove", onMouseMove, true);
	window.removeEventListener("mouseup", onMouseUp, true);
}

/**
 * Open the context menu the long press would have opened.
 * @param {{x: number, y: number, $target?: Element}} state
 */
function replayContextMenu({ x, y, $target }) {
	if (!$target?.isConnected) return;
	const event = new MouseEvent("contextmenu", {
		bubbles: true,
		cancelable: true,
		clientX: x,
		clientY: y,
	});
	replayed.add(event);
	$target.dispatchEvent(event);
}

/**
 * @param {HTMLElement} $tile
 * @param {import("./selection").SelectedEntry[]} items
 */
function createGhost($tile, items) {
	const $icon = tag("span", {
		className: $tile.firstElementChild?.className || "",
	});
	const $chip = tag("div", {
		className: "chip",
		children: [
			$icon,
			tag("span", { className: "name", textContent: items[0].name }),
		],
	});

	if (items.length > 1) {
		$chip.append(
			tag("span", { className: "badge", textContent: String(items.length) }),
		);
	}

	const $ghost = tag("div", {
		className: `file-drag-ghost${items.length > 1 ? " multi" : ""}`,
		children: [$chip],
	});
	const { left, top } = $tile.getBoundingClientRect();
	$ghost.style.transform = `translate3d(${left}px, ${top}px, 0)`;
	document.body.append($ghost);
	return $ghost;
}

/**
 * @param {Element|null} $el
 * @returns {HTMLElement|null} The folder list an entry would be dropped into
 */
function getDropList($el) {
	if (!$el || !container.contains($el)) return null;

	const $tile = $el.closest(".tile[data-type]");
	const type = $tile?.dataset.type;
	const $list =
		type === "dir" || type === "root"
			? $tile.parentElement
			: $el.closest(".list.collapsible");

	if (!$list || !container.contains($list)) return null;
	if ($list.classList.contains("file-list")) return null;
	return $list;
}

/**
 * @param {HTMLElement} $list
 */
function canDropInto($list) {
	const url = $list.firstElementChild?.dataset.url;
	if (!url) return false;

	for (const $source of drag.$sources) {
		if ($source.dataset.url === url) return false;
		// A folder can't go inside itself.
		if (
			$source.dataset.type === "dir" &&
			$source.parentElement.contains($list)
		) {
			return false;
		}
	}

	// Nothing to do if every entry is already in this folder.
	return !drag.items.every(({ $el }) => getParentUrl($el) === url);
}

/**
 * @param {HTMLElement} [$el]
 * @returns {string|undefined}
 */
function getParentUrl($el) {
	if (!$el?.isConnected) return undefined;
	const $own = $el.dataset.type === "dir" ? $el.parentElement : $el;
	return $own.parentElement?.closest(".list.collapsible")?.firstElementChild
		?.dataset.url;
}

/**
 * @param {Element|null} $el
 * @returns {HTMLElement|null}
 */
function getScroller($el) {
	while ($el && $el !== container.parentElement) {
		if ($el.scrollHeight > $el.clientHeight + 1) {
			const { overflowY } = getComputedStyle($el);
			if (overflowY === "auto" || overflowY === "scroll") return $el;
		}
		$el = $el.parentElement;
	}
	return null;
}

/**
 * @param {string} url
 * @returns {HTMLElement[]}
 */
function findTiles(url) {
	return Array.from(
		container.querySelectorAll(`.tile[data-url="${CSS.escape(url)}"]`),
	).filter(($el) => selection.getEntry($el));
}

/**
 * @param {{x: number, y: number}} from
 * @param {{clientX: number, clientY: number}} to
 */
function distance(from, to) {
	return Math.hypot(to.clientX - from.x, to.clientY - from.y);
}

/**
 * @param {Event} e
 * @returns {boolean} Whether another listener already handled the event
 */
function isHandled(e) {
	if (handled.has(e)) return true;
	handled.add(e);
	return false;
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
function clamp(value, min, max) {
	return Math.min(max, Math.max(min, value));
}

/**
 * @param {Event} e
 */
function consume(e) {
	if (e.cancelable) e.preventDefault();
	e.stopPropagation();
	e.stopImmediatePropagation();
}

function vibrate() {
	if (appSettings.value.vibrateOnTap) {
		navigator.vibrate(config.VIBRATION_TIME);
	}
}

export default { init };
