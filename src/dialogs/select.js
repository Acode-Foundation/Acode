import Checkbox from "components/checkbox";
import tile from "components/tile";
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
			className: "scroll" + !textTransform ? " no-text-transform" : "",
		});
		const $select = (
			<div className="prompt select">
				{title ? <strong className="title">{title}</strong> : ""}
				{$list}
			</div>
		);

		items.map((item) => {
			let lead,
				tail,
				itemOptions = {
					value: null,
					text: null,
					icon: null,
					disabled: false,
					letters: "",
					checkbox: null,
				};

			// init item options
			if (typeof item === "object") {
				if (Array.isArray(item)) {
					Object.keys(itemOptions).forEach(
						(key, i) => (itemOptions[key] = item[i]),
					);
				} else {
					itemOptions = Object.assign({}, itemOptions, item);
				}
			} else {
				itemOptions.value = item;
				itemOptions.text = item;
			}

			// handle icon
			if (itemOptions.icon) {
				if (itemOptions.icon === "letters" && !!itemOptions.letters) {
					lead = (
						<i className="icon letters" data-letters={itemOptions.letters}></i>
					);
				} else {
					lead = <i className={`icon ${itemOptions.icon}`}></i>;
				}
			}

			// handle checkbox
			if (itemOptions.checkbox != null) {
				tail = Checkbox({
					checked: itemOptions.checkbox,
				});
			}

			const $item = tile({
				lead,
				tail,
				text: <span className="text" innerHTML={itemOptions.text}></span>,
			});

			$item.tabIndex = "0";
			if (itemOptions.disabled) $item.classList.add("disabled");
			if (options.default === itemOptions.value) {
				$item.classList.add("selected");
				$defaultVal = $item;
			}

			// handle events
			$item.onclick = function () {
				if (!itemOptions.value) return;
				if (hideOnSelect) hide();
				res(itemOptions.value);
			};

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
			if (rejectOnCancel) reject();
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
		}
	});
}

export default select;
