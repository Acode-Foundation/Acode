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
 * Create a select dialog
 * @param {string} title Title of the select
 * @param {string[]} options [value, text, icon, disable?] or string
 * @param {SelectOptions | boolean} opts options or rejectOnCancel
 * @returns {Promise<string>}
 */
function select(title, options, opts = {}) {
	let rejectOnCancel = false;
	if (typeof opts === "boolean") {
		rejectOnCancel = opts;
		opts = {};
	}
	return new Promise((resolve, reject) => {
		const $titleSpan = title ? (
			<strong className="title">{title}</strong>
		) : null;
		const $list = (
			<ul
				className={`scroll ${opts.textTransform === false ? " no-text-transform" : ""}`}
			></ul>
		);
		const selectDiv = (
			<div className="prompt select">
				{$titleSpan ? [$titleSpan, $list] : $list}
			</div>
		);
		const mask = <span className="mask" onclick={cancel}></span>;
		let $defaultVal;

		if (opts.hideOnSelect === undefined) opts.hideOnSelect = true;

		options.map((option) => {
			let value = null;
			let text = null;
			let lead = null;
			let disabled = false;
			if (Array.isArray(option)) {
				value = option[0];
				text = option[1];

				if (option.length > 2 && typeof option[2] === "string") {
					const icon = option[2];
					if (icon === "letters") {
						const letters = option[4];
						lead = <i className="icon letters" data-letters={letters}></i>;
					} else {
						lead = <i className={`icon ${icon}`}></i>;
					}
				}

				option.map((o, i) => {
					if (typeof o === "boolean" && i > 1) disabled = !o;
				});
			} else {
				value = text = option;
			}

			const $item = tile({
				lead,
				text: <span className="text" innerHTML={text}></span>,
			});

			if (opts.default === value) {
				$item.classList.add("selected");
				$defaultVal = $item;
			}

			$item.tabIndex = "0";

			$item.onclick = () => {
				if (value === undefined) return;
				if (opts.hideOnSelect) hide();
				resolve(value);
			};

			if (disabled) $item.classList.add("disabled");

			$list.append($item);
		});

		actionStack.push({
			id: "select",
			action: cancel,
		});

		app.append(selectDiv, mask);
		if ($defaultVal) $defaultVal.scrollIntoView();

		const $firstChild = $defaultVal || $list.firstChild;
		if ($firstChild && $firstChild.focus) $firstChild.focus();

		restoreTheme(true);

		function cancel() {
			hide();
			if (typeof opts.onCancel === "function") opts.onCancel();
			if (rejectOnCancel) reject();
		}

		function hideSelect() {
			selectDiv.classList.add("hide");
			restoreTheme();
			setTimeout(() => {
				selectDiv.remove();
				mask.remove();
			}, 300);
		}

		function hide() {
			if (typeof opts.onHide === "function") opts.onHide();
			actionStack.remove("select");
			hideSelect();
			const listItems = [...$list.children];
			listItems.map((item) => (item.onclick = null));
		}
	});
}

export default select;
