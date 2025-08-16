import alert from "dialogs/alert";
import colorPicker from "dialogs/color";
import prompt from "dialogs/prompt";
import select from "dialogs/select";
import Ref from "html-tag-js/ref";
import actionStack from "lib/actionStack";
import appSettings from "lib/settings";
import FileBrowser from "pages/fileBrowser";
import { isValidColor } from "utils/color/regex";
import helpers from "utils/helpers";
import Checkbox from "./checkbox";
import Page from "./page";
import searchBar from "./searchbar";

/**
 * @typedef {object} SettingsPage
 * @property {(goTo:string)=>void} show show settings page
 * @property {()=>void} hide hide settings page
 * @property {(key:string)=>HTMLElement[]} search search for a setting
 * @property {(title:string)=>void} setTitle set title of settings page
 * @property {()=>void} restoreList restore list to original state
 */

/**
 *  Creates a settings page
 * @param {string} title
 * @param {ListItem[]} settings
 * @param {(key, value) => void} callback  called when setting is changed
 * @param {'united'|'separate'} [type='united']
 * @returns {SettingsPage}
 */
export default function settingsPage(
	title,
	settings,
	callback,
	type = "united",
) {
	let hideSearchBar = () => {};
	const $page = Page(title);
	$page.id = "settings";
	/**@type {HTMLDivElement} */
	const $list = <div tabIndex={0} className="main list"></div>;
	/**@type {ListItem} */
	let note;

	settings = settings.filter((setting) => {
		if ("note" in setting) {
			note = setting.note;
			return false;
		}

		if (!setting.info) {
			Object.defineProperty(setting, "info", {
				get() {
					return strings[`info-${this.key.toLocaleLowerCase()}`];
				},
			});
		}

		return true;
	});

	if (type === "united" || (type === "separate" && settings.length > 5)) {
		const $search = <span className="icon search" attr-action="search"></span>;
		$search.onclick = () =>
			searchBar(
				$list,
				(hide) => {
					hideSearchBar = hide;
				},
				type === "united"
					? () => {
							Object.values(appSettings.uiSettings).forEach((page) => {
								page.restoreList();
							});
						}
					: null,
				type === "united"
					? (key) => {
							const $items = [];
							Object.values(appSettings.uiSettings).forEach((page) => {
								$items.push(...page.search(key));
							});
							return $items;
						}
					: null,
			);

		$page.header.append($search);
	}

	/** DISCLAIMER: do not assign hideSearchBar directly because it can change  */
	$page.ondisconnect = () => hideSearchBar();
	$page.onhide = () => {
		helpers.hideAd();
		actionStack.remove(title);
	};

	listItems($list, settings, callback);
	$page.body = $list;

	/**@type {HTMLElement[]} */
	const children = [...$list.children];

	if (note) {
		$page.append(
			<div className="note">
				<div className="note-title">
					<span className="icon info"></span>
					<span>{strings.info}</span>
				</div>
				<p innerHTML={note}></p>
			</div>,
		);
	}

	$page.append(<div style={{ height: "50vh" }}></div>);

	return {
		/**
		 * Show settings page
		 * @param {string} goTo Key of setting to scroll to and select
		 * @returns {void}
		 */
		show(goTo) {
			actionStack.push({
				id: title,
				action: $page.hide,
			});
			app.append($page);
			helpers.showAd();

			if (goTo) {
				const $item = $list.get(`[data-key="${goTo}"]`);
				if (!$item) return;

				$item.scrollIntoView();
				$item.click();
				return;
			}

			$list.focus();
		},
		hide() {
			$page.hide();
		},
		/**
		 * Search for a setting
		 * @param {string} key
		 */
		search(key) {
			return children.filter((child) => {
				const text = child.textContent.toLowerCase();
				return text.match(key, "i");
			});
		},
		/**
		 * Restore list to original state
		 */
		restoreList() {
			$list.content = children;
		},
		/**
		 * Set title of settings page
		 * @param {string} title
		 */
		setTitle(title) {
			$page.settitle(title);
		},
	};
}

/**
 * @typedef {Object} ListItem
 * @property {string} key
 * @property {string} text
 * @property {string} [icon]
 * @property {string} [iconColor]
 * @property {string} [info]
 * @property {string} [value]
 * @property {(value:string)=>string} [valueText]
 * @property {boolean} [checkbox]
 * @property {string} [prompt]
 * @property {string} [promptType]
 * @property {import('dialogs/prompt').PromptOptions} [promptOptions]
 */

/**
 * Creates a list of settings
 * @param {HTMLUListElement} $list
 * @param {Array<ListItem>} items
 * @param {()=>void} callback called when setting is changed
 */
function listItems($list, items, callback) {
	const $items = [];

	// sort settings by text before rendering
	items.sort((acc, cur) => {
		if (!acc?.text || !cur?.text) return 0;
		return acc.text.localeCompare(cur.text);
	});
	items.forEach((item) => {
		const $setting = Ref();
		const $settingName = Ref();
		/**@type {HTMLDivElement} */
		const $item = (
			<div
				tabIndex={1}
				className={`list-item ${item.sake ? "sake" : ""}`}
				data-key={item.key}
				data-action="list-item"
			>
				<span
					className={`icon ${item.icon || "no-icon"}`}
					style={{ color: item.iconColor }}
				></span>
				<div ref={$setting} className="container">
					<div ref={$settingName} className="text">
						{item.text?.capitalize?.(0) ?? item.text}
					</div>
				</div>
			</div>
		);

		let $checkbox, $valueText;

		if (item.info) {
			$settingName.append(
				<span
					className="icon info info-button"
					data-action="info"
					onclick={() => {
						alert(strings.info, item.info);
					}}
				></span>,
			);
		}

		if (item.checkbox !== undefined || typeof item.value === "boolean") {
			$checkbox = Checkbox("", item.checkbox || item.value);
			$item.appendChild($checkbox);
			$item.style.paddingRight = "10px";
		} else if (item.value !== undefined) {
			$valueText = <small className="value"></small>;
			setValueText($valueText, item.value, item.valueText?.bind(item));
			$setting.append($valueText);
			setColor($item, item.value);
		}

		if (Number.isInteger(item.index)) {
			$items.splice(item.index, 0, $item);
		} else {
			$items.push($item);
		}

		$item.addEventListener("click", onclick);
	});

	$list.content = $items;

	/**
	 * Click handler for $list
	 * @this {HTMLElement}
	 * @param {MouseEvent} e
	 */
	async function onclick(e) {
		const $target = e.target;
		const { key } = e.target.dataset;

		const item = items.find((item) => item.key === key);
		if (!item) return;

		const {
			select: options,
			prompt: promptText,
			color: selectColor,
			checkbox,
			file,
			folder,
			link,
		} = item;
		const { text, value, valueText } = item;
		const { promptType, promptOptions } = item;

		const $valueText = $target.get(".value");
		const $checkbox = $target.get(".input-checkbox");
		let res;

		try {
			if (options) {
				res = await select(text, options, {
					default: value,
				});
			} else if (checkbox !== undefined) {
				$checkbox.toggle();
				res = $checkbox.checked;
			} else if (promptText) {
				res = await prompt(promptText, value, promptType, promptOptions);
				if (res === null) return;
			} else if (file || folder) {
				const mode = file ? "file" : "folder";
				const { url } = await FileBrowser(mode);
				res = url;
			} else if (selectColor) {
				res = await colorPicker(value);
			} else if (link) {
				system.openInBrowser(link);
				return;
			}
		} catch (error) {
			window.log("error", error);
		}

		item.value = res;
		setValueText($valueText, res, valueText?.bind(item));
		setColor($target, res);
		callback.call($target, key, item.value);
	}
}

/**
 * Sets color decoration of a setting
 * @param {HTMLDivElement} $setting
 * @param {string} color
 * @returns
 */
function setColor($setting, color) {
	if (!isValidColor(color)) return;
	/**@type {HTMLSpanElement} */
	const $noIcon = $setting.get(".no-icon");
	if (!$noIcon) return;
	$noIcon.style.backgroundColor = color;
}

/**
 * Sets the value text of a setting
 * @param {HTMLSpanElement} $valueText
 * @param {string} value
 * @param {string} valueText
 * @returns
 */
function setValueText($valueText, value, valueText) {
	if (!$valueText) return;

	if (typeof valueText === "function") {
		value = valueText(value);
	}

	if (typeof value === "string") {
		if (value.match("\n")) [value] = value.split("\n");

		if (value.length > 47) {
			value = value.slice(0, 47) + "...";
		}
	}

	$valueText.textContent = value;
}
