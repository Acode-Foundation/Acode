import "./settingsPage.scss";
import colorPicker from "dialogs/color";
import prompt from "dialogs/prompt";
import select from "dialogs/select";
import Ref from "html-tag-js/ref";
import actionStack from "lib/actionStack";
import appSettings from "lib/settings";
import { hideAd } from "lib/startAd";
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

	if (options.listClassName) {
		$list.classList.add(...options.listClassName.split(" ").filter(Boolean));
	}

	const normalized = normalizeSettings(settings);
	settings = normalized.settings;

	/** DISCLAIMER: do not assign hideSearchBar directly because it can change  */
	$page.ondisconnect = () => hideSearchBar();
	$page.onhide = () => {
		hideAd();
		actionStack.remove(title);
	};

	const state = listItems($list, settings, callback, {
		defaultSearchGroup: title,
		...options,
	});
	let children = [...state.children];
	$page.body = $list;

	const searchableItems = state.searchItems;

	if (shouldEnableSearch(type, settings.length)) {
		const $search = <span className="icon search" attr-action="search"></span>;
		$search.onclick = () =>
			searchBar(
				$list,
				(hide) => {
					hideSearchBar = hide;
				},
				type === "united" ? restoreAllSettingsPages : null,
				createSearchHandler(type, state.searchItems),
			);

		$page.header.append($search);
	}

	if (normalized.note) {
		const $note = createNote(normalized.note);

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
	const useInfoAsDescription =
		options.infoAsDescription ?? Boolean(options.valueInTail);
	const itemByKey = new Map(items.map((item) => [item.key, item]));

	// sort settings by text before rendering (unless preserveOrder is true)
	if (!options.preserveOrder) {
		items.sort((acc, cur) => {
			if (!acc?.text || !cur?.text) return 0;
			return acc.text.localeCompare(cur.text);
		});
	}
	items.forEach((item) => {
		const $item = createListItemElement(item, options, useInfoAsDescription);
		insertRenderedItem(renderedItems, item, $item);
		$item.addEventListener("click", onclick);
		$searchItems.push($item);
	});

	const topLevelChildren = buildListContent(renderedItems, options);

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

		const item = itemByKey.get(key);
		if (!item) return;
		const result = await resolveItemInteraction(item, $target);
		if (result.shouldCallCallback === false) return;
		if (!result.shouldUpdateValue)
			return callback.call($target, key, item.value);

		item.value = result.value;
		updateItemValueDisplay($target, item, options, useInfoAsDescription);

		callback.call($target, key, item.value);
	}
}

function normalizeSettings(settings) {
	/** @type {string | undefined} */
	let note;
	const normalizedSettings = settings.filter((setting) => {
		if ("note" in setting) {
			note = setting.note;
			return false;
		}

		return true;
	});

	return {
		note,
		settings: normalizedSettings,
	};
}

function shouldEnableSearch(type, settingsCount) {
	return type === "united" || (type === "separate" && settingsCount > 5);
}

function restoreAllSettingsPages() {
	Object.values(appSettings.uiSettings).forEach((page) => {
		page.restoreList();
	});
}

function createSearchHandler(type, searchItems) {
	return (key) => {
		if (type === "united") {
			const $items = [];
			Object.values(appSettings.uiSettings).forEach((page) => {
				$items.push(...page.search(key));
			});
			return $items;
		}

		return searchItems.filter((item) => {
			const text = item.textContent.toLowerCase();
			return text.match(key, "i");
		});
	};
}

function createNote(note) {
	return (
		<div className="note">
			<div className="note-title">
				<span className="icon info_outline"></span>
				<span>{strings.info}</span>
			</div>
			<p innerHTML={note}></p>
		</div>
	);
}

function createListItemElement(item, options, useInfoAsDescription) {
	const $setting = Ref();
	const $tail = Ref();
	const isCheckboxItem = isBooleanSetting(item);
	const state = getItemDisplayState(item, useInfoAsDescription);
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
				<div className="text">{item.text?.capitalize?.(0) ?? item.text}</div>
			</div>
			<div ref={$tail} className="setting-tail"></div>
		</div>
	);
	const searchGroup =
		item.searchGroup || item.category || options.defaultSearchGroup;

	if (searchGroup) {
		$item.dataset.searchGroup = searchGroup;
	}

	if (isCheckboxItem) {
		const $checkbox = Checkbox("", item.checkbox || item.value);
		$tail.el.appendChild($checkbox);
	}

	if (state.hasSubtitle) {
		const $valueText = createSubtitleElement(item, state);
		$setting.append($valueText);
		$item.classList.add("has-subtitle");
		if (!state.showInfoAsSubtitle) {
			setColor($item, item.value);
		}
	} else {
		$item.classList.add("compact");
	}

	if (shouldShowTrailingValue(item, options)) {
		$item.classList.add("has-tail-value");
		if (item.select) {
			$item.classList.add("has-tail-select");
		}
		$tail.el.append(createTrailingValueDisplay(item));
	}

	if (shouldShowTailChevron(item)) {
		$tail.el.append(
			<span className="icon keyboard_arrow_right settings-chevron"></span>,
		);
	}

	if (!$tail.el.children.length) {
		$tail.el.remove();
	}

	return $item;
}

function isBooleanSetting(item) {
	return item.checkbox !== undefined || typeof item.value === "boolean";
}

function getItemDisplayState(item, useInfoAsDescription) {
	const isCheckboxItem = isBooleanSetting(item);
	const subtitle = isCheckboxItem
		? item.info
		: getSubtitleText(item, useInfoAsDescription);
	const showInfoAsSubtitle =
		isCheckboxItem ||
		useInfoAsDescription ||
		(item.value === undefined && item.info);

	return {
		subtitle,
		showInfoAsSubtitle,
		hasSubtitle: subtitle !== undefined && subtitle !== null && subtitle !== "",
	};
}

function createSubtitleElement(item, state) {
	const $valueText = <small className="value"></small>;
	setValueText(
		$valueText,
		state.subtitle,
		state.showInfoAsSubtitle ? null : item.valueText?.bind(item),
	);

	if (state.showInfoAsSubtitle) {
		$valueText.classList.add("setting-info");
	}

	return $valueText;
}

function shouldShowTrailingValue(item, options) {
	return (
		options.valueInTail &&
		item.value !== undefined &&
		item.checkbox === undefined &&
		typeof item.value !== "boolean"
	);
}

function createTrailingValueDisplay(item) {
	const $trailingValueText = (
		<small
			className={`setting-trailing-value ${item.select ? "is-select" : ""}`}
		></small>
	);
	setValueText($trailingValueText, item.value, item.valueText?.bind(item));

	return (
		<div className={`setting-value-display ${item.select ? "is-select" : ""}`}>
			{$trailingValueText}
			{item.select ? (
				<span className="icon keyboard_arrow_down setting-value-icon"></span>
			) : null}
		</div>
	);
}

function shouldShowTailChevron(item) {
	return (
		item.chevron ||
		(!item.select &&
			Boolean(item.prompt || item.file || item.folder || item.link))
	);
}

function insertRenderedItem(renderedItems, item, $item) {
	if (Number.isInteger(item.index)) {
		renderedItems.splice(item.index, 0, { item, $item });
		return;
	}

	renderedItems.push({ item, $item });
}

function buildListContent(renderedItems, options) {
	const $content = [];
	/** @type {HTMLElement | null} */
	let $currentSectionCard = null;
	let currentCategory = null;

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
			const section = createSectionElements(category);
			$currentSectionCard = section.$card;
			$content.push(section.$section);
		}

		$currentSectionCard.append($item);
	});

	return $content.length ? $content : renderedItems.map(({ $item }) => $item);
}

function createSectionElements(category) {
	const shouldShowLabel = category !== "__default__";
	const $label = shouldShowLabel ? (
		<div className="settings-section-label">{category}</div>
	) : null;
	const $card = <div className="settings-section-card"></div>;
	return {
		$card,
		$section: (
			<section className="settings-section">
				{$label}
				{$card}
			</section>
		),
	};
}

async function resolveItemInteraction(item, $target) {
	const {
		select: selectOptions,
		prompt: promptText,
		color: selectColor,
		checkbox,
		file,
		folder,
		link,
		text,
		value,
		promptType,
		promptOptions,
	} = item;

	try {
		if (selectOptions) {
			const selectedValue = await select(text, selectOptions, {
				default: value,
			});

			return {
				shouldUpdateValue: selectedValue !== undefined,
				value: selectedValue,
			};
		}

		if (checkbox !== undefined) {
			const $checkbox = $target.get(".input-checkbox");
			$checkbox.toggle();
			return {
				shouldUpdateValue: true,
				value: $checkbox.checked,
			};
		}

		if (promptText) {
			const promptedValue = await prompt(
				promptText,
				value,
				promptType,
				promptOptions,
			);
			if (promptedValue === null) {
				return {
					shouldUpdateValue: false,
					shouldCallCallback: false,
				};
			}

			return {
				shouldUpdateValue: true,
				value: promptedValue,
			};
		}

		if (file || folder) {
			const mode = file ? "file" : "folder";
			const { url } = await FileBrowser(mode);
			return {
				shouldUpdateValue: true,
				value: url,
			};
		}

		if (selectColor) {
			const color = await colorPicker(value);
			return {
				shouldUpdateValue: true,
				value: color,
			};
		}

		if (link) {
			system.openInBrowser(link);
			return {
				shouldUpdateValue: false,
				shouldCallCallback: false,
			};
		}
	} catch (error) {
		window.log("error", error);
	}

	return {
		shouldUpdateValue: false,
		shouldCallCallback: true,
	};
}

function updateItemValueDisplay($target, item, options, useInfoAsDescription) {
	if (options.valueInTail) {
		syncTrailingValueDisplay($target, item, options);
	} else {
		syncInlineValueDisplay($target, item, useInfoAsDescription);
	}

	setColor($target, item.value);
}

function syncTrailingValueDisplay($target, item, options) {
	const shouldRenderTrailingValue = shouldShowTrailingValue(item, options);
	let $tail = $target.get(".setting-tail");
	let $valueDisplay = $target.get(".setting-value-display");

	if (!shouldRenderTrailingValue) {
		$valueDisplay?.remove();
		$target.classList.remove("has-tail-value", "has-tail-select");
		if ($tail && !$tail.children.length) {
			$tail.remove();
		}
		return;
	}

	if (!$tail) {
		$tail = <div className="setting-tail"></div>;
		$target.append($tail);
	}

	if (!$valueDisplay) {
		$valueDisplay = createTrailingValueDisplay(item);
		const $chevron = $tail.get(".settings-chevron");
		if ($chevron) {
			$tail.insertBefore($valueDisplay, $chevron);
		} else {
			$tail.append($valueDisplay);
		}
	}

	const $trailingValueText = $valueDisplay.get(".setting-trailing-value");
	setValueText($trailingValueText, item.value, item.valueText?.bind(item));
	$target.classList.add("has-tail-value");
	$target.classList.toggle("has-tail-select", Boolean(item.select));
}

/**
 * Keeps the inline subtitle/value block in sync when a setting value changes.
 * @param {HTMLElement} $target
 * @param {ListItem} item
 * @param {boolean} useInfoAsDescription
 */
function syncInlineValueDisplay($target, item, useInfoAsDescription) {
	const state = getItemDisplayState(item, useInfoAsDescription);
	let $valueText = $target.get(".value");
	const $container = $target.get(".container");

	if (!$container) return;

	if (!state.hasSubtitle) {
		$valueText?.remove();
		$target.classList.remove("has-subtitle");
		$target.classList.add("compact");
		return;
	}

	if (!$valueText) {
		$valueText = <small className="value"></small>;
		$container.append($valueText);
	}

	$valueText.classList.toggle("setting-info", state.showInfoAsSubtitle);
	setValueText(
		$valueText,
		state.subtitle,
		state.showInfoAsSubtitle ? null : item.valueText?.bind(item),
	);
	$target.classList.add("has-subtitle");
	$target.classList.remove("compact");
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
