import "./style.scss";
import actionStack from "lib/actionStack";

/**
 * @typedef {object} ContextMenuObj
 * @extends HTMLElement
 * @property {function():void} hide hides the menu
 * @property {function():void} show shows the page
 * @property {function():void} destroy destroys the menu
 */

/**
 * @typedef {object} ContextMenuOptions
 * @property {number} left
 * @property {number} top
 * @property {number} bottom
 * @property {number} right
 * @property {string} transformOrigin
 * @property {HTMLElement} toggler
 * @property {function} onshow
 * @property {function} onhide
 * @property {Array<[string, string]>} items Array of [text, action] pairs
 * @property {(this:HTMLElement, event:MouseEvent)=>void} onclick Called when an item is clicked
 * @property {(item:string) => void} onselect Called when an item is selected
 * @property {(this:HTMLElement) => string} innerHTML Called when the menu is shown
 */

/**
 * Create a context menu
 * @param {string|ContextMenuOptions} content Context menu content or options
 * @param {ContextMenuOptions} [options] Options
 * @returns {ContextMenuObj}
 */
export default function Contextmenu(content, options) {
	if (!options && typeof content === "object") {
		options = content;
		content = null;
	} else if (!options) {
		options = {};
	}

	const $el = tag("ul", {
		className: "context-menu scroll",
		innerHTML: content || "",
		onclick(e) {
			if (options.onclick) options.onclick.call(this, e);
			if (options.onselect) {
				const $target = e.target;
				const { action } = $target.dataset;
				if (!action) return;
				hide();
				options.onselect.call(this, action);
			}
		},
		style: {
			top: options.top || "auto",
			left: options.left || "auto",
			right: options.right || "auto",
			bottom: options.bottom || "auto",
			transformOrigin: options.transformOrigin,
		},
	});
	const $mask = tag("span", {
		className: "mask",
		ontouchstart: hide,
		onmousedown: hide,
	});

	if (Array.isArray(options.items)) {
		options.items.forEach(([text, action]) => {
			$el.append(<li data-action={action}>{text}</li>);
		});
	}

	if (!options.innerHTML) addTabindex();

	function show() {
		actionStack.push({
			id: "main-menu",
			action: hide,
		});
		$el.onshow();
		$el.classList.remove("hide");

		if (options.innerHTML) {
			$el.innerHTML = options.innerHTML.call($el);
			addTabindex();
		}

		if (options.toggler) {
			const client = options.toggler.getBoundingClientRect();
			if (!options.top && !options.bottom) {
				$el.style.top = client.top + "px";
			}
			if (!options.left && !options.right) {
				$el.style.right = innerWidth - client.right + "px";
			}
		}

		app.append($el, $mask);

		const $firstChild = $el.firstChild;
		if ($firstChild && $firstChild.focus) $firstChild.focus();
	}

	function hide() {
		actionStack.remove("main-menu");
		$el.onhide();
		$el.classList.add("hide");
		setTimeout(() => {
			$mask.remove();
			$el.remove();
		}, 100);
	}

	function toggle() {
		if ($el.parentElement) return hide();
		show();
	}

	/**
	 * Whether a direct child of the menu is an enabled, actionable row.
	 *
	 * Separators (`<hr>`) and rows marked `disabled`/`separator` are excluded,
	 * so keyboard users can neither focus them nor trigger actions the menu
	 * presents as unavailable. Without this, Enter/Space would dispatch a click
	 * on a disabled row, and a programmatic click bypasses the CSS
	 * `pointer-events: none` that normally blocks it.
	 * @param {Element|null|undefined} $item
	 * @returns {boolean}
	 */
	function isActionableItem($item) {
		if (!$item || $item.tagName === "HR") return false;
		if ($item.classList.contains("disabled")) return false;
		if ($item.classList.contains("separator")) return false;
		return true;
	}

	/**
	 * All enabled, actionable rows in the menu, in visual order.
	 * @returns {HTMLElement[]}
	 */
	function getActionableItems() {
		if ($el.classList.contains("disabled")) return [];
		return [...$el.children].filter(isActionableItem);
	}

	function addTabindex() {
		/**@type {Array<HTMLLIElement>} */
		const children = [...$el.children];
		for (let $child of children) {
			if (isActionableItem($child)) {
				$child.tabIndex = "0";
			} else {
				$child.removeAttribute("tabindex");
			}
		}
	}

	/**
	 * Returns the currently focused actionable menu row, or null if focus is
	 * on a disabled row, a nested control, or outside the menu.
	 * @returns {HTMLElement|null}
	 */
	function getFocusedItem() {
		const $active = document.activeElement;
		if (!$active || $active.parentElement !== $el) return null;
		return isActionableItem($active) ? $active : null;
	}

	/**
	 * Moves focus to the next/previous actionable menu row, wrapping around at
	 * the ends. `direction` is +1 for next, -1 for previous.
	 * @param {number} direction
	 */
	function moveFocus(direction) {
		const items = getActionableItems();
		if (!items.length) return;

		const currentIndex = items.indexOf(document.activeElement);
		let nextIndex;
		if (currentIndex === -1) {
			nextIndex = direction > 0 ? 0 : items.length - 1;
		} else {
			nextIndex = (currentIndex + direction + items.length) % items.length;
		}
		items[nextIndex]?.focus();
	}

	/**
	 * Turns a keyboard activation (Enter/Space on a focused menu row) into a
	 * real click event, so both selection patterns this component supports
	 * handle it identically to a pointer click:
	 *  - the `items`/`onselect` array form, whose routing lives in the
	 *    `onclick` handler above
	 *  - a consumer's own click listener attached directly to $el, as used by
	 *    menus built with the `innerHTML` option
	 *
	 * The dispatched event is marked with `keyboardActivated` so consumers that
	 * filter out synthetic `detail === 0` ghost clicks (e.g. to ignore the click
	 * that follows a touch-based long press) can still recognize and allow this
	 * one through.
	 *
	 * Disabled rows and separators are ignored, so they can never be activated
	 * from the keyboard.
	 * @param {HTMLElement|null} $item
	 */

	function activateItem($item) {
		if ($el.classList.contains("disabled")) return;
		if (!$item || $item.parentElement !== $el || !isActionableItem($item))
			return;
		const clickEvent = new MouseEvent("click", {
			bubbles: true,
			cancelable: true,
			view: window,
		});
		Object.defineProperty(clickEvent, "keyboardActivated", {
			value: true,
		});
		$item.dispatchEvent(clickEvent);
	}

	/**
	 * Whether a keydown event should be handled by the menu's keyboard
	 * navigation. Keys originating from interactive descendants (e.g. the file
	 * menu's read-only checkbox) are left alone so those controls keep their
	 * native Space/Enter behavior.
	 * @param {KeyboardEvent} e
	 * @returns {boolean}
	 */
	function isMenuKeyEvent(e) {
		const $target = e.target;
		if ($target === $el) return true;
		return (
			$target instanceof Element &&
			$target.parentElement === $el &&
			isActionableItem($target)
		);
	}

	/**
	 * Keyboard support for the menu: Enter/Space activates the focused row,
	 * Up/Down arrows move focus between actionable rows (wrapping at the ends),
	 * Home/End jump to the first/last actionable row, and Escape closes the menu
	 * and returns focus to the toggler.
	 *
	 * Events originating from nested interactive controls are ignored (except
	 * Escape), so those controls are never prevented from handling their own
	 * keys.
	 * @param {KeyboardEvent} e
	 */
	function onMenuKeydown(e) {
		if (e.key === "Escape" || e.key === "Esc") {
			e.preventDefault();
			hide();
			options.toggler?.focus?.();
			return;
		}

		if (!isMenuKeyEvent(e)) return;

		switch (e.key) {
			case "Enter":
			case " ":
			case "Spacebar":
				e.preventDefault();
				activateItem(getFocusedItem());
				break;
			case "ArrowDown":
			case "Down":
				e.preventDefault();
				moveFocus(1);
				break;
			case "ArrowUp":
			case "Up":
				e.preventDefault();
				moveFocus(-1);
				break;
			case "Home":
				e.preventDefault();
				getActionableItems()[0]?.focus();
				break;
			case "End": {
				const items = getActionableItems();
				items[items.length - 1]?.focus();
				break;
			}
		}
	}

	function destroy() {
		$el.removeEventListener("keydown", onMenuKeydown);
		$el.remove();
		$mask.remove();
		options.toggler?.removeEventListener("click", toggle);
	}

	if (options.toggler) {
		options.toggler.addEventListener("click", toggle);
	}

	$el.addEventListener("keydown", onMenuKeydown);

	$el.hide = hide;
	$el.show = show;
	$el.destroy = destroy;
	$el.onshow = options.onshow || (() => {});
	$el.onhide = options.onhide || (() => {});

	return $el;
}
