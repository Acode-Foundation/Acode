import Checkbox from "components/checkbox";
import tile from "components/tile";
import DOMPurify from "dompurify";
import actionStack from "lib/actionStack";
import restoreTheme from "lib/restoreTheme";

/**
 * @typedef {object} SelectOptions
 * @property {boolean} [hideOnSelect]
 * @property {boolean} [textTransform]
 * @property {string} [default]
 * @property {function():void} [onCancel]
 * @property {function():void} [onHide]
 */

/**
 * @typedef {object} SelectItem
 * @property {string} [value]
 * @property {string} [text]
 * @property {string} [icon]
 * @property {boolean} [disabled]
 * @property {string} [letters]
 * @property {boolean} [checkbox]
 * @property {HTMLElement} [tailElement]
 * @property {function(Event):void} [ontailclick]
 */

/**
 * Create a select dialog
 * @param {string} title Title of the select
 * @param {string | string[] | SelectItem} items Object or [value, text, icon, disable?, letters?, checkbox?] or String
 * @param {SelectOptions | boolean} options options or rejectOnCancel
 * @returns {Promise<string>}
 */
function select(title, items, options = {}) {
	let rejectOnCancel = false;
	if (typeof options === "boolean") {
		rejectOnCancel = options;
		options = {};
	}

	return new Promise((res, rej) => {
		const { textTransform = false, hideOnSelect = true } = options;
		let $defaultVal;

		// elements
		const $mask = <span className="mask" onclick={cancel}></span>;
		const $list = tag("ul", {
			className: `scroll${!textTransform ? " no-text-transform" : ""}`,
		});
		const $titleSpan = title
			? <strong className="title">{title}</strong>
			: null;
		const $select = (
			<div className="prompt select">
				{$titleSpan ? [$titleSpan, $list] : $list}
			</div>
		);

		// Track tail click handlers for cleanup
		const tailClickHandlers = new Map();

		items.map((item) => {
			let lead,
				tail = null,
				itemOptions = {
					value: null,
					text: null,
					icon: null,
					disabled: false,
					letters: "",
					checkbox: null,
					tailElement: null,
					ontailclick: null,
				};

			// init item options
			if (typeof item === "object") {
				if (Array.isArray(item)) {
					// This format does NOT support custom tail or handlers so pass object :)
					Object.keys(itemOptions).forEach(
						(key, i) => (itemOptions[key] = item[i]),
					);

					item.map((o, i) => {
						if (typeof o === "boolean" && i > 1) itemOptions.disabled = !o;
					});
				} else {
					itemOptions = Object.assign({}, itemOptions, item);
				}
			} else {
				itemOptions.value = item;
				itemOptions.text = item;
			}

			// handle icon (lead)
			if (itemOptions.icon) {
				if (itemOptions.icon === "letters" && !!itemOptions.letters) {
					lead = (
						<i className="icon letters" data-letters={itemOptions.letters}></i>
					);
				} else {
					lead = <i className={`icon ${itemOptions.icon}`}></i>;
				}
			}

			// handle tail (checkbox or custom element)
			if (itemOptions.tailElement) {
				tail = itemOptions.tailElement;
			} else if (itemOptions.checkbox != null) {
				tail = Checkbox({
					checked: itemOptions.checkbox,
				});
			}

			const $item = tile({
				lead,
				tail,
				text: (
					<span
						className="text"
						innerHTML={DOMPurify.sanitize(itemOptions.text)}
					></span>
				),
			});

			$item.tabIndex = "0";
			if (itemOptions.disabled) $item.classList.add("disabled");
			if (options.default === itemOptions.value) {
				$item.classList.add("selected");
				$defaultVal = $item;
			}

			$item.onclick = function (e) {
				// Check if clicked element or any parent up to the item has data-action
				let target = e.target;
				while (target && target !== $item) {
					if (target.hasAttribute("data-action")) {
						// Stop propagation and prevent default
						e.stopPropagation();
						e.preventDefault();
						return false;
					}
					target = target.parentElement;
				}

				if (itemOptions.value === undefined) return;
				if (hideOnSelect) hide();
				res(itemOptions.value);
			};

			// Handle tail click event if a custom tail and handler are provided
			if (itemOptions.tailElement && itemOptions.ontailclick && tail) {
				// Apply the pointer-events: all directly to the tail element
				tail.style.pointerEvents = "all";

				const tailClickHandler = function (e) {
					e.stopPropagation();
					e.preventDefault();
					itemOptions.ontailclick.call($item, e);
				};

				tail.addEventListener("click", tailClickHandler);
				tailClickHandlers.set(tail, tailClickHandler);
			}

			$list.append($item);
		});

		actionStack.push({
			id: "select",
			action: cancel,
		});

		app.append($select, $mask);
		if ($defaultVal) $defaultVal.scrollIntoView();

		const $firstChild = $defaultVal || $list.firstChild;
		if ($firstChild && $firstChild.focus) $firstChild.focus();
		restoreTheme(true);

		function cancel() {
			hide();
			if (typeof options.onCancel === "function") options.onCancel();
			if (rejectOnCancel) rej();
		}

		function hideSelect() {
			$select.classList.add("hide");
			restoreTheme();
			setTimeout(() => {
				$select.remove();
				$mask.remove();
			}, 300);
		}

		function hide() {
			if (typeof options.onHide === "function") options.onHide();
			actionStack.remove("select");
			hideSelect();
			let listItems = [...$list.children];
			listItems.map((item) => (item.onclick = null));
			// Clean up tail click handlers
			tailClickHandlers.forEach((handler, element) => {
				element.removeEventListener("click", handler);
			});
			tailClickHandlers.clear();
		}
	});
}

export default select;
