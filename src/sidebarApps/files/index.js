import "./style.scss";
import Sidebar from "components/sidebar";
import settings from "lib/settings";

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

	let height = (lists.length - 1) * ITEM_HEIGHT;
	let activeFileList;

	if (settings.value.openFileListPos === settings.OPEN_FILE_LIST_POS_SIDEBAR) {
		const [firstList] = lists;
		if (firstList.classList.contains("file-list")) {
			activeFileList = firstList;
			if (firstList.unclasped) {
				const heightOffset = height - ITEM_HEIGHT;
				const totalHeight =
					ITEM_HEIGHT * activeFileList.$ul.children.length + ITEM_HEIGHT;
				const maxHeight =
					lists.length === 1 || !lists.slice(1).find((list) => list.unclasped)
						? window.innerHeight
						: window.innerHeight / 2;
				const minHeight = Math.min(totalHeight, maxHeight - heightOffset);

				activeFileList.style.maxHeight = `${minHeight}px`;
				activeFileList.style.height = `${minHeight}px`;
				height += minHeight - ITEM_HEIGHT;
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
