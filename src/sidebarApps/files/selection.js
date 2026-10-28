import "./selection.scss";
import select from "dialogs/select";
import tag from "html-tag-js";
import config from "lib/config";
import appSettings from "lib/settings";
import helpers from "utils/helpers";

/**
 * @typedef {"copy"|"cut"|"delete"|"copy-path"|"rename"|"open"|"move"} SelectionAction
 */

/**
 * @typedef {object} SelectedEntry
 * @property {string} url
 * @property {"file"|"dir"} type
 * @property {string} name
 * @property {string} [rootUrl] Url of the open folder containing the entry
 * @property {HTMLElement} [$el]
 */

const ACTION_STACK_ID = "file-selection";
const ENTRY_SELECTOR =
	'.tile[data-url][data-type="file"], .tile[data-url][data-type="dir"]';
// Bar widths below which the label and then the buttons are compacted.
const COMPACT_WIDTH = 270;
const TIGHT_WIDTH = 210;
// Range selections fill in as a short wave instead of all at once.
const WAVE_STEP_MS = 14;
const WAVE_MAX_MS = 180;

/** @type {Map<string, SelectedEntry>} */
const selected = new Map();
/** @type {HTMLElement} */
let container;
/** @type {string|null} */
let anchorUrl = null;
/** @type {(action: SelectionAction, items: SelectedEntry[], targetUrl?: string) => Promise<boolean|void>} */
let actionHandler;
/** @type {MutationObserver} */
let observer;
/** @type {HTMLElement} */
let $bar;
/** @type {HTMLElement} */
let $count;
let busy = false;

/**
 * Attach selection handling to the files sidebar container.
 * @param {HTMLElement} $container
 */
function init($container) {
	container = $container;
	// Capture phase runs before the tree's own tile listeners, so a tap can
	// select instead of opening the file or toggling the folder.
	container.addEventListener("click", onClick, true);
	container.addEventListener("contextmenu", onContextMenu, true);
	observer = new MutationObserver(onTreeMutation);
	editorManager.on("remove-folder", onRemoveFolder);
}

/**
 * @param {(action: SelectionAction, items: SelectedEntry[], targetUrl?: string) => Promise<boolean|void>} handler
 * Return false from the handler to keep the selection open.
 */
function onAction(handler) {
	actionHandler = handler;
}

function isActive() {
	return !!container?.classList.contains("selecting");
}

/**
 * Enter selection mode, optionally selecting an entry.
 * @param {HTMLElement} [$tile]
 */
function start($tile) {
	if (!container) return;

	if (!isActive()) {
		container.classList.add("selecting");
		observer.observe(container, { childList: true, subtree: true });
		document.addEventListener("keydown", onKeydown);
		actionStack.push({ id: ACTION_STACK_ID, action: exit });
		syncBar();
		updateBarSize();
		vibrate();
	}

	if ($tile && getEntry($tile)) {
		setSelected($tile, true);
		anchorUrl = $tile.dataset.url;
	}

	update(1);
}

function exit() {
	if (!isActive()) return;

	container.classList.remove("selecting");
	for (const $el of container.querySelectorAll(".tile.selected")) {
		markEntry($el, false);
	}

	selected.clear();
	anchorUrl = null;
	observer.disconnect();
	document.removeEventListener("keydown", onKeydown);
	actionStack.remove(ACTION_STACK_ID);
}

/**
 * Keep the bar right after the files container so the CSS sibling rule can
 * show it only while the files app is the visible sidebar app.
 */
function syncBar() {
	if (!container?.isConnected) return;
	if (!$bar) createBar();
	if ($bar.previousElementSibling !== container) container.after($bar);
}

/**
 * @param {MouseEvent} e
 */
function onClick(e) {
	const $tile = getEntry(e.target);
	if (!$tile) return;

	const additive = e.ctrlKey || e.metaKey;

	if (!isActive()) {
		if (!additive && !e.shiftKey) return;
		consume(e);
		start($tile);
		return;
	}

	// The folder icon keeps expanding folders so nested entries can be reached.
	const isPlainTap = !additive && !e.shiftKey;
	if (isPlainTap && helpers.isDir($tile.dataset.type) && isOnLead($tile, e)) {
		return;
	}

	consume(e);
	if (e.shiftKey) selectRange($tile);
	else toggle($tile);
}

/**
 * @param {PointerEvent} e
 */
function onContextMenu(e) {
	if (!isActive()) return;

	const $tile = getEntry(e.target);
	if (!$tile) return;

	consume(e);

	// Right click acts on the selection; long press extends it.
	if (e.pointerType === "mouse") {
		if (!selected.has($tile.dataset.url)) {
			setSelected($tile, true);
			anchorUrl = $tile.dataset.url;
			update(1);
		}
		showMore();
		return;
	}

	vibrate();
	if (anchorUrl && anchorUrl !== $tile.dataset.url) selectRange($tile);
	else toggle($tile);
}

/**
 * @param {KeyboardEvent} e
 */
function onKeydown(e) {
	if (e.key === "Escape") exit();
}

/**
 * Re-apply selection to entries re-rendered by the tree (e.g. a folder
 * collapsed and expanded again).
 * @param {MutationRecord[]} records
 */
function onTreeMutation(records) {
	for (const { addedNodes } of records) {
		for (const node of addedNodes) {
			if (!(node instanceof Element)) continue;
			const $tiles = node.matches(ENTRY_SELECTOR)
				? [node]
				: node.querySelectorAll(ENTRY_SELECTOR);
			for (const $tile of $tiles) {
				if (selected.has($tile.dataset.url)) markEntry($tile, true);
			}
		}
	}
}

/**
 * Drop entries of an open folder that was closed.
 * @param {{url: string}} folder
 */
function onRemoveFolder({ url } = {}) {
	if (!isActive()) return;
	for (const [key, entry] of selected) {
		if (entry.rootUrl === url) selected.delete(key);
	}
	update(-1);
}

/**
 * @param {HTMLElement} $tile
 */
function toggle($tile) {
	const { url } = $tile.dataset;
	const value = !selected.has(url);
	setSelected($tile, value);
	anchorUrl = url;
	update(value ? 1 : -1);
}

/**
 * Select every visible entry between the anchor and the given entry.
 * @param {HTMLElement} $tile
 */
function selectRange($tile) {
	const $tiles = getVisibleEntries();
	const to = $tiles.indexOf($tile);
	const from = $tiles.findIndex(($el) => $el.dataset.url === anchorUrl);

	if (from === -1 || to === -1) {
		toggle($tile);
		return;
	}

	const step = from < to ? 1 : -1;
	const range = [];
	for (let i = from; i !== to + step; i += step) range.push($tiles[i]);
	selectWave(range);
}

function selectAll() {
	const roots = new Set(
		Array.from(container.querySelectorAll(".tile.selected"), getRoot),
	);
	const $tiles = getVisibleEntries().filter(
		($el) => !roots.size || roots.has(getRoot($el)),
	);
	selectWave($tiles);
}

/**
 * Select entries in order with a slight stagger.
 * @param {HTMLElement[]} $tiles
 */
function selectWave($tiles) {
	let delay = 0;
	for (const $tile of $tiles) {
		if (selected.has($tile.dataset.url)) continue;
		$tile.style.setProperty("--select-delay", `${delay}ms`);
		setSelected($tile, true);
		delay = Math.min(delay + WAVE_STEP_MS, WAVE_MAX_MS);
		setTimeout(() => $tile.style.removeProperty("--select-delay"), 400);
	}
	update(1);
}

/**
 * @param {HTMLElement} $tile
 * @param {boolean} value
 */
function setSelected($tile, value) {
	const { url, type, name } = $tile.dataset;
	const rootUrl = getRoot($tile).firstElementChild?.dataset.url;
	if (value) selected.set(url, { url, type, name, rootUrl });
	else selected.delete(url);

	for (const $el of findEntries(url)) markEntry($el, value);
}

/**
 * @param {HTMLElement} $tile
 * @param {boolean} value
 */
function markEntry($tile, value) {
	$tile.classList.toggle("selected", value);
	// Lets CSS tint a selected folder's contents without :has().
	if (helpers.isDir($tile.dataset.type)) {
		$tile.parentElement?.classList.toggle("has-selected-title", value);
	}
}

/**
 * Sync the bar with the selection, leaving selection mode once it's empty.
 * @param {1|-1} direction Whether the count went up or down
 */
function update(direction) {
	if (!selected.size) {
		exit();
		return;
	}

	if (!$bar) return;
	const count = String(selected.size);
	if ($count.textContent === count) return;

	$count.textContent = count;
	$count.classList.remove("up", "down");
	void $count.offsetWidth; // restart the animation
	$count.classList.add(direction > 0 ? "up" : "down");
}

/**
 * @param {SelectionAction} action
 */
async function run(action) {
	if (!selected.size) return;
	await perform(action, getItems());
}

/**
 * Run an action on the given entries, then leave selection mode.
 * @param {SelectionAction} action
 * @param {SelectedEntry[]} items
 * @param {string} [targetUrl]
 */
async function perform(action, items, targetUrl) {
	if (busy || !actionHandler || !items.length) return;

	busy = true;
	$bar?.classList.add("busy");
	try {
		const result = await actionHandler(action, items, targetUrl);
		if (result !== false) exit();
	} catch (error) {
		console.error(error);
		helpers.error(error);
	} finally {
		busy = false;
		$bar?.classList.remove("busy");
	}
}

/**
 * @returns {SelectedEntry[]} Selected entries with their rendered elements
 */
function getItems() {
	return Array.from(selected.values(), (item) => ({
		...item,
		$el: findEntries(item.url)[0],
	}));
}

async function showMore() {
	const items = Array.from(selected.values());
	const files = items.filter(({ type }) => helpers.isFile(type)).length;
	const openText = strings.open || "Open";
	const options = [
		["select-all", strings["select all"], "library_add_check"],
		["copy-path", strings["copy relative path"], "attach_file"],
	];

	if (items.length === 1) {
		options.push(["rename", strings.rename, "edit"]);
	}

	if (files) {
		const text = files > 1 ? `${openText} (${files})` : openText;
		options.push(["open", text, "launchopen_in_new"]);
	}

	const action = await select(getLabel(), options);
	if (!isActive()) return;
	if (action === "select-all") selectAll();
	else run(action);
}

function createBar() {
	$count = tag("span", { className: "count" });
	$bar = tag("div", {
		className: "file-selection-bar",
		children: [
			barButton("exit", "clearclose", strings.cancel),
			tag("div", {
				className: "label",
				children: [
					$count,
					tag("span", {
						className: "unit",
						textContent: strings.selected || "selected",
					}),
				],
			}),
			barButton("copy", "copy", strings.copy),
			barButton("cut", "cut", strings.cut),
			barButton("delete", "delete danger", strings.delete),
			barButton("more", "more_vert", strings.more || "More"),
		],
	});

	$bar.setAttribute("role", "toolbar");
	if (window.ResizeObserver) {
		new ResizeObserver(updateBarSize).observe($bar);
	}
	$bar.addEventListener("click", (e) => {
		const action = e.target.closest("[data-action]")?.dataset.action;
		if (!action) return;
		if (action === "exit") exit();
		else if (action === "more") showMore();
		else run(action);
	});
}

/**
 * Stand-in for container queries, which old WebViews don't support.
 */
function updateBarSize() {
	if (!$bar) return;
	const width = $bar.clientWidth;
	if (!width) return;
	$bar.classList.toggle("compact", width < COMPACT_WIDTH);
	$bar.classList.toggle("tight", width < TIGHT_WIDTH);
}

/**
 * @param {string} action
 * @param {string} icon
 * @param {string} title
 */
function barButton(action, icon, title) {
	const $button = tag("button", { type: "button", className: `icon ${icon}` });
	$button.dataset.action = action;
	$button.title = title;
	$button.setAttribute("aria-label", title);
	return $button;
}

function getLabel() {
	return `${selected.size} ${strings.selected || "selected"}`;
}

/**
 * @param {EventTarget} target
 * @returns {HTMLElement|null} The selectable tree entry for the target
 */
function getEntry(target) {
	if (!(target instanceof Element)) return null;
	const $tile = target.closest(ENTRY_SELECTOR);
	if (!$tile || !container.contains($tile)) return null;
	if ($tile.closest(".file-list")) return null;
	return $tile;
}

/**
 * @param {string} url
 * @returns {HTMLElement[]}
 */
function findEntries(url) {
	return Array.from(
		container.querySelectorAll(`.tile[data-url="${CSS.escape(url)}"]`),
	).filter(($el) => getEntry($el));
}

/**
 * Entries in display order, skipping those inside collapsed folders.
 * @returns {HTMLElement[]}
 */
function getVisibleEntries() {
	return Array.from(container.querySelectorAll(ENTRY_SELECTOR)).filter(
		($el) => getEntry($el) && $el.getClientRects().length,
	);
}

/**
 * @param {HTMLElement} $el
 * @returns {HTMLElement} The top level open folder containing the entry
 */
function getRoot($el) {
	while ($el.parentElement && $el.parentElement !== container) {
		$el = $el.parentElement;
	}
	return $el;
}

/**
 * @param {HTMLElement} $tile
 * @param {MouseEvent} e
 */
function isOnLead($tile, e) {
	const $lead = $tile.firstElementChild;
	if (!$lead) return false;
	const { left, right } = $lead.getBoundingClientRect();
	return e.clientX >= left && e.clientX <= right;
}

/**
 * @param {Event} e
 */
function consume(e) {
	e.preventDefault();
	e.stopPropagation();
	e.stopImmediatePropagation();
}

function vibrate() {
	if (appSettings.value.vibrateOnTap) {
		navigator.vibrate(config.VIBRATION_TIME);
	}
}

export default {
	init,
	onAction,
	start,
	exit,
	syncBar,
	perform,
	getItems,
	getEntry,
	isSelected: (url) => selected.has(url),
	get active() {
		return isActive();
	},
};
