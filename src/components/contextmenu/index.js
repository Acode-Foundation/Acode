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

	function addTabindex() {
		/**@type {Array<HTMLLIElement>} */
		const children = [...$el.children];
		for (const $el of children) $el.tabIndex = "0";
	}

	function destroy() {
		$el.remove();
		$mask.remove();
		options.toggler?.removeEventListener("click", toggle);
	}

	if (options.toggler) {
		options.toggler.addEventListener("click", toggle);
	}

	$el.hide = hide;
	$el.show = show;
	$el.destroy = destroy;
	$el.onshow = options.onshow || (() => {});
	$el.onhide = options.onhide || (() => {});

	return $el;
}
