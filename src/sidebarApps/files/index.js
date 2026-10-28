import "./style.scss";
import Sidebar from "components/sidebar";
import fileIcons from "lib/fileIcons";
import settings from "lib/settings";
import dragMove from "./dragMove";
import selection from "./selection";

/**@type {HTMLElement} */
let container;

export default [
	"documents", // icon
	"files", // id
	strings["files"], // title
	initApp, // init function
	false, // prepend
	onSelected, // onSelected function
];

/**
 * Initialize files app
 * @param {HTMLElement} el
 */
function initApp(el) {
	container = el;
	container.classList.add("files");
	container.setAttribute("data-msg", strings["open folder"]);
	container.style.overflowX = "auto";
	container.addEventListener("click", clickHandler);
	// Drag listens first so a long press can become a drag before selection
	// or the context menu sees it.
	dragMove.init(container);
	selection.init(container);
	editorManager.on(
		["new-file", "int-open-file-list", "remove-file"],
		(position) => {
			if (
				typeof position === "string" &&
				position !== settings.OPEN_FILE_LIST_POS_SIDEBAR
			)
				return;
			const fileList = container.get(":scope > div.file-list");
			if (fileList) fixHeight(fileList);
		},
	);
	editorManager.on("add-folder", fixHeight);
	Sidebar.on("show", onSelected);
}

/**
 * On selected handler for files app
 * @param {HTMLElement} el
 */
function onSelected(el) {
	// Phone sidebars and inactive sidebar apps are detached, so document-wide
	// icon updates cannot reach them until this view is shown again.
	fileIcons.refreshRenderedIcons(container);
	selection.syncBar();
	// Heights measured while the sidebar was detached come out wrong.
	const $openFolder = container.querySelector(
		":scope > .list:not(.hidden):not(.file-list)",
	);
	if ($openFolder) fixHeight($openFolder);
	const $scrollableLists = container.getAll(":scope .scroll[data-scroll-top]");
	$scrollableLists.forEach(($el) => {
		$el.scrollTop = $el.dataset.scrollTop;
	});
}

/**
 * Click handler for files app
 * @param {MouseEvent} e
 * @returns
 */
function clickHandler(e) {
	if (!container.children.length) {
		acode.exec("open-folder");
		return;
	}

	const { target } = e;
	if (target.matches(".files>.list>.tile")) {
		fixHeight(target.parentElement);
	}
}

/**
 * Update list height
 * @param {HTMLElement} target Target element
 */
export function fixHeight(target) {
	const lists = Array.from(container.getAll(":scope > div"));
	const ITEM_HEIGHT = 30;
	// Headers are taller than rows (36px, 40px on wide screens); measure them so
	// the expanded list doesn't overflow below the sidebar.
	const headerHeight =
		container.querySelector(":scope > .list > .tile")?.offsetHeight ||
		ITEM_HEIGHT;

	let height = (lists.length - 1) * headerHeight;
	let activeFileList;

	if (settings.value.openFileListPos === settings.OPEN_FILE_LIST_POS_SIDEBAR) {
		const [firstList] = lists;
		if (firstList.classList.contains("file-list")) {
			activeFileList = firstList;
			if (firstList.unclasped) {
				const heightOffset = height - headerHeight;
				const totalHeight =
					ITEM_HEIGHT * activeFileList.$ul.children.length + headerHeight;
				const maxHeight =
					lists.length === 1 || !lists.slice(1).find((list) => list.unclasped)
						? window.innerHeight
						: window.innerHeight / 2;
				const minHeight = Math.min(totalHeight, maxHeight - heightOffset);

				activeFileList.style.maxHeight = `${minHeight}px`;
				activeFileList.style.height = `${minHeight}px`;
				height += minHeight - headerHeight;
			}
		}
	}

	lists.forEach((list) => {
		if (list === activeFileList) return;

		if (target === activeFileList) {
			if (list.collapsed) {
				list.style.removeProperty("max-height");
				list.style.removeProperty("height");
				return;
			}
			target = list;
		}

		if (list === target && target.unclasped) {
			list.style.maxHeight = `calc(100% - ${height}px)`;
			list.style.height = `calc(100% - ${height}px)`;
			return;
		}

		if (list.collapsed) {
			list.style.removeProperty("max-height");
			list.style.removeProperty("height");
			return;
		}

		list.collapse();
		list.style.removeProperty("max-height");
		list.style.removeProperty("height");
		return;
	});
}
