import tag from "html-tag-js";
import tile from "./tile";

/**
 * @typedef {object} CollapsibleBase
 * @property {HTMLElement} $title
 * @property {HTMLUListElement} $ul
 * @property {function(void):void} ontoggle
 * @property {function(void):void} collapse
 * @property {function(void):void} expand
 * @property {boolean} collapsed
 * @property {boolean} unclasped
 */

/**
 * @typedef {CollapsibleBase & HTMLElement} Collapsible
 */

/**
 * Create a collapsible list
 * @param {string} titleText Title of the list
 * @param {boolean} hidden If true, the list will be hidden
 * @param {"indicator"|"folder"} type Type of the list toggle indicator
 * @param {object} [options] Configuration options
 * @param {HTMLElement} [options.tail] Tail element of the title
 * @param {string} [options.type] Type of the list element
 * @param {boolean} [options.allCaps] If true, the title will be in all caps
 * @param {function(this:Collapsible):void} [options.ontoggle] Called when the list is toggled
 * @returns {Collapsible}
 */
export default function collapsableList(
	titleText,
	type = "indicator",
	options = {},
) {
	let onscroll = null;
	const $ul = tag("ul", {
		className: "scroll",
		onscroll: onUlScroll,
	});
	const $collapseIndicator = tag("span", {
		className: `icon ${type}`,
	});
	const $title = tile({
		lead: $collapseIndicator,
		type: "div",
		text: options.allCaps ? titleText.toUpperCase() : titleText,
		tail: options.tail,
	});
	const $mainWrapper = tag(options.type || "div", {
		className: "list collapsible hidden",
		children: [$title, $ul],
	});

	let collapse = () => {
		$mainWrapper.classList.add("hidden");
		if ($mainWrapper.ontoggle) $mainWrapper.ontoggle.call($mainWrapper);
		delete $ul.dataset.scrollTop;
	};

	let expand = () => {
		$mainWrapper.classList.remove("hidden");
		if ($mainWrapper.ontoggle) $mainWrapper.ontoggle.call($mainWrapper);
	};

	$title.classList.add("light");
	$title.addEventListener("click", toggle);

	[$title, $mainWrapper].forEach(defineProperties);

	$mainWrapper.dataset.id = `${Math.random().toString(36).substring(2, 15)}`;

	return $mainWrapper;

	function onUlScroll() {
		if (onscroll) onscroll.call($ul);
		$ul.dataset.scrollTop = $ul.scrollTop;
	}

	function toggle() {
		if ($title.collapsed) {
			expand();
		} else {
			collapse();
		}
	}

	function defineProperties($el) {
		Object.defineProperties($el, {
			$title: {
				get() {
					return $title;
				},
			},
			$ul: {
				get() {
					return $ul;
				},
			},
			ontoggle: {
				get() {
					return options.ontoggle;
				},
				set(fun) {
					if (typeof fun === "function") options.ontoggle = fun;
				},
			},
			collapse: {
				get() {
					return collapse || (() => {});
				},
				set(fun) {
					if (typeof fun === "function") collapse = fun;
				},
			},
			expand: {
				get() {
					return expand || (() => {});
				},
				set(fun) {
					if (typeof fun === "function") expand = fun;
				},
			},
			collapsed: {
				get() {
					return $mainWrapper.classList.contains("hidden");
				},
			},
			unclasped: {
				get() {
					return !this.collapsed;
				},
			},
			onscroll: {
				get() {
					return onscroll;
				},
				set(fun) {
					if (typeof fun === "function") {
						onscroll = fun;
					}
				},
			},
			scrollTop: {
				get() {
					return $ul.dataset.scrollTop || 0;
				},
				set(val) {
					$ul.dataset.scrollTop = val;
					$ul.scrollTop = val;
				},
			},
		});
	}
}
