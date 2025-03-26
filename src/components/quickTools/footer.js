/**
 * @typedef {import('html-tag-js/ref')} Ref
 */

import settings from "lib/settings";
import items, { ref } from "./items";

/**
 * Create a row with common buttons
 * @param {object} param0 Attributes
 * @param {number} [param0.row] Row number
 */
export const Row = ({ row }) => {
	const startIndex =
		(row - 1) * settings.QUICKTOOLS_GROUP_CAPACITY * settings.QUICKTOOLS_GROUPS;
	return (
		<div id={`row${row}`} className="button-container">
			{(() => {
				const sections = [];
				for (let i = 0; i < settings.QUICKTOOLS_GROUPS; ++i) {
					const section = [];
					for (let j = 0; j < settings.QUICKTOOLS_GROUP_CAPACITY; ++j) {
						const index =
							startIndex + (i * settings.QUICKTOOLS_GROUP_CAPACITY + j);
						const itemIndex = settings.value.quicktoolsItems[index]; // saved item index
						const item = items[itemIndex]; // item object
						section.push(<RowItem {...item} index={index} />);
					}
					sections.push(<div className="section">{section}</div>);
				}
				return sections;
			})()}
		</div>
	);
};

/**
 * Create a search row with search input and buttons
 * @returns {Element}
 */
export const SearchRow1 = ({ inputRef }) => (
	<div className="button-container" id="search_row1">
		<input ref={inputRef} type="search" placeholder={strings.search} />
		<RowItem icon="arrow_back" action="search-prev" />
		<RowItem icon="arrow_forward" action="search-next" />
		<RowItem icon="settings" action="search-settings" />
	</div>
);

/**
 * Create a search row with replace input and buttons
 * @returns {Element}
 */
export const SearchRow2 = ({ inputRef, posRef, totalRef }) => (
	<div className="button-container" id="search_row2">
		<input ref={inputRef} type="text" placeholder={strings.replace} />
		<RowItem icon="replace" action="search-replace" />
		<RowItem icon="replace_all" action="search-replace-all" />
		<div className="search-status">
			<span ref={posRef}>0</span>
			<span>of</span>
			<span ref={totalRef}>0</span>
		</div>
	</div>
);

/**@type {HTMLElement} */
export const $footer = <footer id="quick-tools" tabIndex={-1} />;

/**@type {HTMLElement} */
export const $toggler = (
	<span className="floating icon keyboard_arrow_up" id="quicktools-toggler" />
);

/**@type {HTMLTextAreaElement} */
export const $input = (
	<textarea
		autocapitalize="none"
		style={{
			opacity: 0,
			height: 0,
			width: 0,
			pointerEvent: "none",
			pointerEvents: "none",
			position: "fixed",
			top: 0,
			left: 0,
		}}
	/>
);

/**
 *
 * @param {RowItem} param0 Attributes
 * @param {string} param0.id Button id
 * @param {string} param0.icon Icon name
 * @param {string} param0.letters Letters to show on button
 * @param {'insert'|'command'|'key'|'custom'} param0.action Action type
 * @param {string|Function} param0.value Value of button
 * @param {Ref} param0.ref Reference to button
 * @param {boolean} param0.repeat Whether to repeat the action or not
 * @returns {HTMLButtonElement}
 */
export function RowItem({ id, icon, letters, action, value, ref, repeat }) {
	const $item = (
		<button
			type="button"
			ref={ref}
			className={`icon ${icon}`}
			data-id={id}
			data-letters={letters}
			data-action={action}
			data-repeat={repeat}
		/>
	);

	if (typeof value === "function") {
		$item.value = value;
	} else if (value !== undefined) {
		$item.dataset.value = value;
	}

	return $item;
}

/**
 * Create a list of RowItem components
 * @param {object} param0 Attributes
 * @param {Array<RowItem>} param0.extras Extra buttons
 * @returns {Array<Element>}
 */
function Extras({ extras }) {
	const div = <div className="section" />;
	if (Array.isArray(extras)) {
		for (const i of extras) {
			if (i instanceof HTMLElement) {
				div.appendChild(i);
				return;
			}

			div.append(<RowItem {...i} />);
		}
	}
	return div;
}

/**
 * @typedef {object} RowItem
 * @property {string} icon
 * @property {string} letters
 * @property {'insert'|'command'|'key'|'custom'} action
 * @property {string|Function} value
 * @property {Ref} ref
 */
