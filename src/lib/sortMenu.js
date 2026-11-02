import appSettings from "./settings";

/**
 * Listing order, shared by every file list in the app: the file browser, the
 * sidebar folder trees and the settings page all read and write the same
 * `fileBrowser` settings, so a choice made in one place applies everywhere.
 *
 * Kept free of UI imports so the file tree can use it without pulling in the
 * settings pages.
 */

/** Sort keys in the order they are offered. */
export const SORT_FIELDS = ["name", "size", "date", "type"];

/**
 * Localised label for a sort field.
 * @param {"name"|"size"|"date"|"type"} field
 * @returns {string}
 */
export function getSortFieldLabel(field) {
	switch (field) {
		case "size":
			return strings.size || "Size";
		case "date":
			return strings["last modified"] || "Last modified";
		case "type":
			return strings.type || "Type";
		default:
			return strings.name || "Name";
	}
}

/**
 * Stores the listing order chosen from a header menu or the settings page.
 * @param {{sortBy?: string, sortOrder?: "asc"|"desc"}} order
 */
export function setSort({ sortBy, sortOrder } = {}) {
	const fileBrowser = appSettings.value.fileBrowser;
	if (SORT_FIELDS.includes(sortBy)) fileBrowser.sortBy = sortBy;
	if (sortOrder === "asc" || sortOrder === "desc") {
		fileBrowser.sortOrder = sortOrder;
	}
	// A named field implies sorting; "none" would silently ignore the choice.
	fileBrowser.sortByName = true;
	appSettings.update();
}

/**
 * Current sort selection, with the legacy `sortByName` flag folded in.
 *
 * `sortBy` is missing from settings saved before it existed (they are only
 * filled in at the top level on upgrade), and the app sorts by name in that
 * case, so report "name" rather than leaving the menu with no active row.
 * @returns {{sortBy: string, sortOrder: "asc"|"desc"}}
 */
export function getSort() {
	const fileBrowser = appSettings.value.fileBrowser || {};
	return {
		sortBy:
			fileBrowser.sortByName === false
				? "none"
				: (fileBrowser.sortBy ?? "name"),
		sortOrder: fileBrowser.sortOrder === "desc" ? "desc" : "asc",
	};
}

/**
 * Applies a chosen sort field, flipping the direction when it is already
 * active. A newly chosen field starts in the direction that is useful first:
 * largest and newest leading, names A–Z.
 * @param {"name"|"size"|"date"|"type"} field
 */
export function chooseSortField(field) {
	const current = getSort();
	const flip = current.sortBy === field;
	const descendingFirst = field === "size" || field === "date";

	setSort({
		sortBy: field,
		sortOrder: flip
			? current.sortOrder === "asc"
				? "desc"
				: "asc"
			: descendingFirst
				? "desc"
				: "asc",
	});
}

/**
 * Rows for a sort menu, marking the active field and its direction.
 * @returns {string} markup for a `Contextmenu` innerHTML
 */
export function renderSortMenu() {
	const { sortBy, sortOrder } = getSort();
	const rows = SORT_FIELDS.map((field) => {
		const active = sortBy === field;
		const direction = active
			? `<span class="icon arrow ${sortOrder === "asc" ? "arrow_upward" : "arrow_downward"}"></span>`
			: "";
		return (
			`<li action="sort" data-sort-by="${field}" class="${active ? "selected" : ""}">` +
			`<span>${getSortFieldLabel(field)}</span>${direction}</li>`
		);
	});

	return rows.join("");
}

/**
 * Reacts to a click inside a sort menu built by `renderSortMenu`.
 * @param {MouseEvent} event
 * @returns {boolean} whether a sort field was chosen
 */
export function handleSortMenuClick(event) {
	const $target = event.target.closest?.("[data-sort-by]");
	if (!$target) return false;
	chooseSortField($target.dataset.sortBy);
	return true;
}
