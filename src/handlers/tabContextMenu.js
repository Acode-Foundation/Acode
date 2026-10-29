import Contextmenu from "components/contextmenu";

const EDGE_MARGIN = 8;
const MENU_WIDTH_ESTIMATE = 240;
const MENU_ITEM_HEIGHT = 50;
const MENU_ITEM_COUNT = 4;
const MENU_HEIGHT_ESTIMATE = MENU_ITEM_COUNT * MENU_ITEM_HEIGHT;
const GAP = 4;
const SYNTHETIC_CLICK_WINDOW = 700;

/**
 * How far the pointer must travel before a long press counts as a drag
 * instead of a tab context menu request. Matches the slop used in
 * handlers/editorFileTab.js so the sidebar long-press gesture behaves
 * consistently with the tab-bar drag gesture.
 */
const DRAG_MENU_SLOP = 8;

/**
 * Open the context menu for a file tab.
 *
 * Actions are executed through `acode.exec`, so they use the same commands
 * and prompts as the rest of the app:
 *  - close-tab           close the pressed tab
 *  - close-tabs-in-group close all tabs in the same tab group/pane
 *  - close-tabs-to-left  close tabs left of the pressed tab
 *  - close-tabs-to-right close tabs right of the pressed tab
 *
 * @param {object} file The `EditorFile` whose tab was long pressed / right clicked
 * @returns {HTMLElement|undefined} The context menu element, if it was shown.
 */
export default function openTabContextMenu(file) {
	if (!file || !file.tab || !file.tab.isConnected) return;

	const menu = Contextmenu({
		...positionMenu(file.tab),
		innerHTML: getMenuItemsHtml,
	});

	const guardUntil = Date.now() + SYNTHETIC_CLICK_WINDOW;

	/**
	 * Touch gestures that open a context menu can be followed by a synthetic
	 * click (detail === 0). Ignore those so releasing the finger does not
	 * accidentally activate a menu item underneath it.
	 *
	 * Keyboard-activated clicks dispatched by the Contextmenu component are
	 * also `detail === 0` (since they're synthetic MouseEvents), but they're
	 * marked with `keyboardActivated` so they're never mistaken for a
	 * touch-release ghost click and suppressed here.
	 * @param {MouseEvent} event
	 */
	const suppressSyntheticClick = (event) => {
		if (Date.now() > guardUntil) return;
		if (event.keyboardActivated) return;
		if (event.detail !== 0) return;
		if (!menu.contains(event.target)) return;
		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation?.();
	};

	const removeSuppressor = () => {
		document.removeEventListener("click", suppressSyntheticClick, true);
	};

	// Make sure the document-level suppressor is always detached, even if the
	// menu is destroyed without ever firing `onhide`.
	const originalDestroy = menu.destroy;
	menu.destroy = () => {
		removeSuppressor();
		originalDestroy();
	};

	document.addEventListener("click", suppressSyntheticClick, true);
	menu.onhide = removeSuppressor;

	menu.addEventListener("click", (event) => {
		// A synthetic click with detail === 0 that isn't marked as a real
		// keyboard activation is a touch-release ghost click; ignore it.
		if (event.detail === 0 && !event.keyboardActivated) return;
		const $target = event.target;
		const action = $target?.getAttribute?.("action");
		if (!action) return;
		menu.hide();
		removeSuppressor();
		acode.exec(action, file.id);
	});

	menu.show();
	repositionMenu(menu, file.tab);
	return menu;
}

/**
 * Show the tab context menu after the ongoing long press / right click ends.
 *
 * Used in layouts where a long press does not start a tab drag (sidebar open
 * file list). Opening while the finger is still down would let the release
 * hit the menu, so the menu is opened when the pointer is lifted instead.
 *
 * A small movement threshold (DRAG_MENU_SLOP) is allowed before the gesture
 * is treated as a drag/scroll rather than a menu request, matching the
 * tab-bar drag gesture in handlers/editorFileTab.js. Without this, ordinary
 * finger drift during a long press would cancel the menu before touchend.
 *
 * @param {object} file The `EditorFile` whose tab was long pressed / right clicked
 * @param {MouseEvent} event The contextmenu event
 */
export function openTabContextMenuOnRelease(file, event) {
	if (!file || !file.tab || !file.tab.isConnected) return;
	event.preventDefault?.();
	event.stopPropagation?.();

	const { clientX: originX, clientY: originY } = getEventClientPos(event);

	let opened = false;
	let cancelled = false;

	const open = () => {
		if (opened || cancelled) return;
		opened = true;
		cleanup();
		openTabContextMenu(file);
	};

	const onPointerMove = (moveEvent) => {
		const { clientX, clientY } = getEventClientPos(moveEvent);
		if (
			Math.abs(clientX - originX) <= DRAG_MENU_SLOP &&
			Math.abs(clientY - originY) <= DRAG_MENU_SLOP
		) {
			// Still within the slop threshold; treat as a stationary long
			// press rather than a drag/scroll attempt.
			return;
		}
		// Moved far enough after the long press means the user intends to
		// scroll or drag, not to open a menu.
		cancelled = true;
		cleanup();
	};

	const onCancel = () => {
		cancelled = true;
		cleanup();
	};

	function cleanup() {
		document.removeEventListener("touchmove", onPointerMove, true);
		document.removeEventListener("touchend", open, true);
		document.removeEventListener("touchcancel", onCancel, true);
		document.removeEventListener("mouseup", open, true);
		document.removeEventListener("mouseleave", onCancel, true);
	}

	document.addEventListener("touchmove", onPointerMove, true);
	document.addEventListener("touchend", open, true);
	document.addEventListener("touchcancel", onCancel, true);
	document.addEventListener("mouseup", open, true);
	document.addEventListener("mouseleave", onCancel, true);
}

/**
 * Extracts the client X/Y position from a mouse or touch event.
 * @param {MouseEvent|TouchEvent} e
 * @returns {{clientX: number, clientY: number}}
 */
function getEventClientPos(e) {
	const touch = e.touches?.[0] || e.changedTouches?.[0];
	if (touch) {
		return { clientX: touch.clientX, clientY: touch.clientY };
	}
	return { clientX: e.clientX ?? 0, clientY: e.clientY ?? 0 };
}

function getMenuItemsHtml() {
	const closeText = strings["close file"] || "Close file";
	const closeAllText = strings["close all"] || "Close all";
	const closeLeftText = strings["close tabs to left"] || "Close Left";
	const closeRightText = strings["close tabs to right"] || "Close Right";
	return `
		<li action="close-tab">${closeText}</li>
		<li action="close-tabs-in-group">${closeAllText}</li>
		<li action="close-tabs-to-left">${closeLeftText}</li>
		<li action="close-tabs-to-right">${closeRightText}</li>
	`;
}

/**
 * Initial position for the menu next to the tab, based on size estimates so
 * the first paint is already close to the final place. `repositionMenu` then
 * corrects it using the real, measured size.
 * @param {HTMLElement} $tab
 * @returns {object}
 */
function positionMenu($tab) {
	const rect = $tab.getBoundingClientRect();
	const style = {};

	if (rect.left + MENU_WIDTH_ESTIMATE <= innerWidth - EDGE_MARGIN) {
		style.left = `${Math.max(EDGE_MARGIN, rect.left)}px`;
	} else {
		style.right = `${Math.max(EDGE_MARGIN, innerWidth - rect.right)}px`;
	}

	if (rect.bottom + MENU_HEIGHT_ESTIMATE <= innerHeight - EDGE_MARGIN) {
		style.top = `${rect.bottom + GAP}px`;
		style.transformOrigin = "top center";
	} else {
		style.bottom = `${Math.max(EDGE_MARGIN, innerHeight - rect.top + GAP)}px`;
		style.transformOrigin = "bottom center";
	}

	return style;
}

/**
 * Correct the menu position using its measured size after it has been shown,
 * flipping/clamping so it always stays fully inside the viewport. `offsetWidth`
 * and `offsetHeight` are used instead of `getBoundingClientRect()` so the
 * measurement is unaffected by the menu's open/close transform animation.
 * @param {HTMLElement} menu
 * @param {HTMLElement} $tab
 */
function repositionMenu(menu, $tab) {
	if (!menu.isConnected) return;

	const menuWidth = menu.offsetWidth;
	const menuHeight = menu.offsetHeight;
	if (!menuWidth || !menuHeight) return;

	const tabRect = $tab.getBoundingClientRect();
	const viewportWidth = innerWidth;
	const viewportHeight = innerHeight;

	const maxLeft = Math.max(
		EDGE_MARGIN,
		viewportWidth - menuWidth - EDGE_MARGIN,
	);
	let left = tabRect.left;
	if (left + menuWidth > viewportWidth - EDGE_MARGIN) {
		left = tabRect.right - menuWidth;
	}
	left = Math.min(Math.max(EDGE_MARGIN, left), maxLeft);
	menu.style.left = `${left}px`;
	menu.style.right = "auto";

	let transformOrigin = "top center";
	const maxTop = Math.max(
		EDGE_MARGIN,
		viewportHeight - menuHeight - EDGE_MARGIN,
	);
	let top = tabRect.bottom + GAP;
	if (top + menuHeight > viewportHeight - EDGE_MARGIN) {
		top = tabRect.top - menuHeight - GAP;
		transformOrigin = "bottom center";
	}
	top = Math.min(Math.max(EDGE_MARGIN, top), maxTop);
	menu.style.top = `${top}px`;
	menu.style.bottom = "auto";
	menu.style.transformOrigin = transformOrigin;
}
