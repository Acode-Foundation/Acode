import "./settingsPage.scss";
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
 * @typedef {Object} SettingsPageOptions
 * @property {boolean} [preserveOrder] - If true, items are listed in the order provided instead of alphabetical
 * @property {string} [pageClassName] - Extra classes to apply to the page element
 * @property {string} [listClassName] - Extra classes to apply to the list element
 * @property {string} [defaultSearchGroup] - Default search result group label for this page
 * @property {boolean} [infoAsDescription] - Override subtitle behavior; defaults to true when valueInTail is enabled
 * @property {boolean} [valueInTail] - Render item.value as a trailing control/value instead of subtitle
 * @property {boolean} [groupByDefault] - Wrap uncategorized settings in a grouped section shell
 * @property {"top"|"bottom"} [notePosition] - Render note before or after the settings list
 */

/**
 *  Creates a settings page
 * @param {string} title
 * @param {ListItem[]} settings
 * @param {(key, value) => void} callback  called when setting is changed
 * @param {'united'|'separate'} [type='united']
 * @param {SettingsPageOptions} [options={}]
 * @returns {SettingsPage}
 */
export default function settingsPage(
	title,
	settings,
	callback,
	type = "united",
	options = {},
) {
	let hideSearchBar = () => {};
	const $page = Page(title);
	$page.id = "settings";

	if (options.pageClassName) {
		$page.classList.add(...options.pageClassName.split(" ").filter(Boolean));
	}

	/**@type {HTMLDivElement} */
	const $list = <div tabIndex={0} className="main list"></div>;
	/**@type {ListItem} */
	let note;

	if (options.listClassName) {
		$list.classList.add(...options.listClassName.split(" ").filter(Boolean));
	}

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
				(key) => {
					if (type === "united") {
						const $items = [];
						Object.values(appSettings.uiSettings).forEach((page) => {
							$items.push(...page.search(key));
						});
						return $items;
					}

					return state.searchItems.filter((item) => {
						const text = item.textContent.toLowerCase();
						return text.match(key, "i");
					});
				},
			);

		$page.header.append($search);
	}

	/** DISCLAIMER: do not assign hideSearchBar directly because it can change  */
	$page.ondisconnect = () => hideSearchBar();
	$page.onhide = () => {
		helpers.hideAd();
		actionStack.remove(title);
	};

	const state = listItems($list, settings, callback, {
		defaultSearchGroup: title,
		...options,
	});
	let children = [...state.children];
	$page.body = $list;

	const searchableItems = state.searchItems;

	if (note) {
		const $note = (
			<div className="note">
				<div className="note-title">
					<span className="icon info_outline"></span>
					<span>{strings.info}</span>
				</div>
				<p innerHTML={note}></p>
			</div>
		);

		if (options.notePosition === "top") {
			children.unshift($note);
		} else {
			children.push($note);
		}
	}

	$list.content = children;
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
			return searchableItems.filter((child) => {
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
 * @property {string} [category]
 * @property {string} [searchGroup]
 * @property {boolean} [checkbox]
 * @property {boolean} [chevron]
 * @property {string} [prompt]
 * @property {string} [promptType]
 * @property {import('dialogs/prompt').PromptOptions} [promptOptions]
 */

/**
 * Creates a list of settings
 * @param {HTMLUListElement} $list
 * @param {Array<ListItem>} items
 * @param {()=>void} callback called when setting is changed
 * @param {SettingsPageOptions} [options={}]
 */
function listItems($list, items, callback, options = {}) {
	const renderedItems = [];
	const $searchItems = [];
	const $content = [];
	const useInfoAsDescription =
		options.infoAsDescription ?? Boolean(options.valueInTail);
	/** @type {HTMLElement | null} */
	let $currentSectionCard = null;
	let currentCategory = null;

	// sort settings by text before rendering (unless preserveOrder is true)
	if (!options.preserveOrder) {
		items.sort((acc, cur) => {
			if (!acc?.text || !cur?.text) return 0;
			return acc.text.localeCompare(cur.text);
		});
	}
	items.forEach((item) => {
		const $setting = Ref();
		const $settingName = Ref();
		const $tail = Ref();
		/**@type {HTMLDivElement} */
		const $item = (
			<div
				tabIndex={1}
				className={`list-item ${item.sake ? "sake" : ""} ${item.icon ? "" : "no-leading-icon"}`}
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
				<div ref={$tail} className="setting-tail"></div>
			</div>
		);

		let $checkbox, $valueText;
		let $trailingValueText;
		const subtitle = getSubtitleText(item, useInfoAsDescription);
		const showInfoAsSubtitle =
			useInfoAsDescription || (item.value === undefined && item.info);
		const searchGroup =
			item.searchGroup || item.category || options.defaultSearchGroup;
		const hasSubtitle =
			subtitle !== undefined && subtitle !== null && subtitle !== "";
		const shouldShowTailChevron =
			item.chevron ||
			(!item.select &&
				Boolean(item.prompt || item.file || item.folder || item.link));

		if (searchGroup) {
			$item.dataset.searchGroup = searchGroup;
		}

		let subtitleRendered = false;

		if (item.checkbox !== undefined || typeof item.value === "boolean") {
			$checkbox = Checkbox("", item.checkbox || item.value);
			$tail.el.appendChild($checkbox);
		} else if (subtitle !== undefined) {
			$valueText = <small className="value"></small>;
			setValueText(
				$valueText,
				subtitle,
				showInfoAsSubtitle ? null : item.valueText?.bind(item),
			);
			if (showInfoAsSubtitle) {
				$valueText.classList.add("setting-info");
			}
			$setting.append($valueText);
			subtitleRendered = true;
			if (!showInfoAsSubtitle) {
				setColor($item, item.value);
			}
		}

		if (subtitleRendered) {
			$item.classList.add("has-subtitle");
		} else {
			$item.classList.add("compact");
		}

		if (
			options.valueInTail &&
			item.value !== undefined &&
			item.checkbox === undefined &&
			typeof item.value !== "boolean"
		) {
			$item.classList.add("has-tail-value");

			if (item.select) {
				$item.classList.add("has-tail-select");
			}

			$trailingValueText = (
				<small
					className={`setting-trailing-value ${item.select ? "is-select" : ""}`}
				></small>
			);
			setValueText($trailingValueText, item.value, item.valueText?.bind(item));

			const $valueDisplay = (
				<div
					className={`setting-value-display ${item.select ? "is-select" : ""}`}
				>
					{$trailingValueText}
					{item.select
						? <span className="icon keyboard_arrow_down setting-value-icon"></span>
						: null}
				</div>
			);
			$tail.el.append($valueDisplay);
		}

		if (shouldShowTailChevron) {
			$tail.el.append(
				<span className="icon keyboard_arrow_right settings-chevron"></span>,
			);
		}

		if (!$tail.el.children.length) {
			$tail.el.remove();
		}

		if (Number.isInteger(item.index)) {
			renderedItems.splice(item.index, 0, { item, $item });
		} else {
			renderedItems.push({ item, $item });
		}

		$item.addEventListener("click", onclick);
		$searchItems.push($item);
	});

	renderedItems.forEach(({ item, $item }) => {
		const category =
			item.category?.trim() || (options.groupByDefault ? "__default__" : "");

		if (!category) {
			currentCategory = null;
			$currentSectionCard = null;
			$content.push($item);
			return;
		}

		if (currentCategory !== category || !$currentSectionCard) {
			currentCategory = category;
			const shouldShowLabel = category !== "__default__";
			const $label = shouldShowLabel
				? <div className="settings-section-label">{category}</div>
				: null;
			$currentSectionCard = <div className="settings-section-card"></div>;
			$content.push(
				<section className="settings-section">
					{$label}
					{$currentSectionCard}
				</section>,
			);
		}

		$currentSectionCard.append($item);
	});

	const topLevelChildren = $content.length
		? $content
		: renderedItems.map(({ $item }) => $item);

	$list.content = topLevelChildren;

	return {
		children: topLevelChildren,
		searchItems: $searchItems,
	};

	/**
	 * Click handler for $list
	 * @this {HTMLElement}
	 * @param {MouseEvent} e
	 */
	async function onclick(e) {
		const $target = e.currentTarget;
		const { key } = $target.dataset;

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
		const $trailingValueText = $target.get(".setting-trailing-value");
		let res;
		let shouldUpdateValue = false;

		try {
			if (options) {
				res = await select(text, options, {
					default: value,
				});
				shouldUpdateValue = res !== undefined;
			} else if (checkbox !== undefined) {
				$checkbox.toggle();
				res = $checkbox.checked;
				shouldUpdateValue = true;
			} else if (promptText) {
				res = await prompt(promptText, value, promptType, promptOptions);
				if (res === null) return;
				shouldUpdateValue = true;
			} else if (file || folder) {
				const mode = file ? "file" : "folder";
				const { url } = await FileBrowser(mode);
				res = url;
				shouldUpdateValue = true;
			} else if (selectColor) {
				res = await colorPicker(value);
				shouldUpdateValue = true;
			} else if (link) {
				system.openInBrowser(link);
				return;
			}
		} catch (error) {
			window.log("error", error);
		}

		if (shouldUpdateValue) {
			item.value = res;
			setValueText($valueText, res, valueText?.bind(item));
			setValueText($trailingValueText, res, valueText?.bind(item));
			setColor($target, res);
		}

		callback.call($target, key, item.value);
	}
}

function getSubtitleText(item, useInfoAsDescription) {
	if (useInfoAsDescription) {
		return item.info;
	}

	return item.value ?? item.info;
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
		const shouldPreserveFullText = $valueText.classList.contains("value");
		if (!shouldPreserveFullText) {
			if (value.includes("\n")) [value] = value.split("\n");

			if (value.length > 47) {
				value = value.slice(0, 47) + "...";
			}
		}
	}

	$valueText.textContent = value;
}
