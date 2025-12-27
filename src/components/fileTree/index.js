import "./style.scss";
import tile from "components/tile";
import VirtualList from "components/virtualList";
import tag from "html-tag-js";
import helpers from "utils/helpers";
import Path from "utils/Path";

const VIRTUALIZATION_THRESHOLD = 100;
const ITEM_HEIGHT = 30;

/**
 * @typedef {object} FileTreeOptions
 * @property {function(string): Promise<Array>} getEntries - Function to get directory entries
 * @property {function(string, string): void} [onFileClick] - File click handler
 * @property {function(string, string, string, HTMLElement): void} [onContextMenu] - Context menu handler
 * @property {Object<string, boolean>} [expandedState] - Map of expanded folder URLs
 * @property {function(string, boolean): void} [onExpandedChange] - Called when folder expanded state changes
 */

/**
 * FileTree component for rendering folder contents with virtual scrolling
 */
export default class FileTree {
	/**
	 * @param {HTMLElement} container
	 * @param {FileTreeOptions} options
	 */
	constructor(container, options = {}) {
		this.container = container;
		this.container.classList.add("file-tree");

		this.options = options;
		this.virtualList = null;
		this.entries = [];
		this.isLoading = false;
		this.childTrees = new Map(); // Track child trees for cleanup
		this.depth = options._depth || 0; // Internal: nesting depth
	}

	/**
	 * Load and render entries for a directory
	 * @param {string} url - Directory URL
	 */
	async load(url) {
		if (this.isLoading) return;
		this.isLoading = true;
		this.currentUrl = url;

		try {
			this.clear();

			const entries = await this.options.getEntries(url);
			this.entries = helpers.sortDir(entries, {
				sortByName: true,
				showHiddenFiles: true,
			});

			if (this.entries.length > VIRTUALIZATION_THRESHOLD) {
				this.renderVirtualized();
			} else {
				this.renderWithFragment();
			}
		} finally {
			this.isLoading = false;
		}
	}

	/**
	 * Render using DocumentFragment for batch DOM updates (small folders)
	 */
	renderWithFragment() {
		const fragment = document.createDocumentFragment();

		for (const entry of this.entries) {
			const $el = this.createEntryElement(entry);
			fragment.appendChild($el);
		}

		this.container.appendChild(fragment);
	}

	/**
	 * Render using virtual scrolling (large folders)
	 */
	renderVirtualized() {
		this.container.classList.add("virtual-scroll");

		this.virtualList = new VirtualList(this.container, {
			itemHeight: ITEM_HEIGHT,
			buffer: 15,
			renderItem: (entry, recycledEl) =>
				this.createEntryElement(entry, recycledEl),
		});

		this.virtualList.setItems(this.entries);
	}

	/**
	 * Create DOM element for a file/folder entry
	 * @param {object} entry
	 * @param {HTMLElement} [recycledEl] - Optional recycled element for reuse
	 * @returns {HTMLElement}
	 */
	createEntryElement(entry, recycledEl) {
		const name = entry.name || Path.basename(entry.url);

		if (entry.isDirectory) {
			return this.createFolderElement(name, entry.url);
		} else {
			return this.createFileElement(name, entry.url, recycledEl);
		}
	}

	/**
	 * Create folder element (collapsible)
	 * @param {string} name
	 * @param {string} url
	 * @returns {HTMLElement}
	 */
	createFolderElement(name, url) {
		const $wrapper = tag("div", {
			className: "list collapsible hidden",
		});

		const $indicator = tag("span", { className: "icon folder" });

		const $title = tile({
			lead: $indicator,
			type: "div",
			text: name,
		});

		$title.classList.add("light");
		$title.dataset.url = url;
		$title.dataset.name = name;
		$title.dataset.type = "dir";

		const $content = tag("ul", { className: "scroll folder-content" });
		$wrapper.append($title, $content);

		// Child file tree for nested folders
		let childTree = null;

		const toggle = async () => {
			const isExpanded = !$wrapper.classList.contains("hidden");

			if (isExpanded) {
				// Collapse
				$wrapper.classList.add("hidden");

				if (childTree) {
					childTree.destroy();
					this.childTrees.delete(url);
					childTree = null;
				}
				this.options.onExpandedChange?.(url, false);
			} else {
				// Expand
				$wrapper.classList.remove("hidden");
				$title.classList.add("loading");

				// Create child tree with incremented depth
				childTree = new FileTree($content, {
					...this.options,
					_depth: this.depth + 1,
				});
				this.childTrees.set(url, childTree);
				try {
					await childTree.load(url);
				} finally {
					$title.classList.remove("loading");
				}
				this.options.onExpandedChange?.(url, true);
			}
		};

		$title.addEventListener("click", (e) => {
			e.stopPropagation();
			toggle();
		});

		$title.addEventListener("contextmenu", (e) => {
			e.stopPropagation();
			this.options.onContextMenu?.("dir", url, name, $title);
		});

		// Check if folder should be expanded from saved state
		if (this.options.expandedState?.[url]) {
			queueMicrotask(() => toggle());
		}

		// Add properties for external access
		Object.defineProperties($wrapper, {
			collapsed: { get: () => $wrapper.classList.contains("hidden") },
			unclasped: { get: () => !$wrapper.classList.contains("hidden") },
			$title: { get: () => $title },
			$ul: { get: () => $content },
			expand: {
				value: () => !$wrapper.classList.contains("hidden") || toggle(),
			},
			collapse: {
				value: () => $wrapper.classList.contains("hidden") || toggle(),
			},
		});

		return $wrapper;
	}

	/**
	 * Create file element (tile)
	 * @param {string} name
	 * @param {string} url
	 * @param {HTMLElement} [recycledEl] - Optional recycled element for reuse
	 * @returns {HTMLElement}
	 */
	createFileElement(name, url, recycledEl) {
		const iconClass = helpers.getIconForFile(name);

		// Try to recycle existing element
		if (recycledEl && recycledEl.dataset.type === "file") {
			recycledEl.dataset.url = url;
			recycledEl.dataset.name = name;
			const textEl = recycledEl.querySelector(".text");
			const iconEl = recycledEl.querySelector("span:first-child");
			if (textEl) textEl.textContent = name;
			if (iconEl) iconEl.className = iconClass;
			return recycledEl;
		}

		const $tile = tile({
			lead: tag("span", { className: iconClass }),
			text: name,
		});

		$tile.dataset.url = url;
		$tile.dataset.name = name;
		$tile.dataset.type = "file";

		$tile.addEventListener("click", (e) => {
			e.stopPropagation();
			this.options.onFileClick?.(url, name);
		});

		$tile.addEventListener("contextmenu", (e) => {
			e.stopPropagation();
			this.options.onContextMenu?.("file", url, name, $tile);
		});

		return $tile;
	}

	/**
	 * Clear all rendered content
	 */
	clear() {
		// Destroy all child trees
		for (const childTree of this.childTrees.values()) {
			childTree.destroy();
		}
		this.childTrees.clear();

		if (this.virtualList) {
			this.virtualList.destroy();
			this.virtualList = null;
		}
		this.container.innerHTML = "";
		this.container.classList.remove("virtual-scroll");
		this.entries = [];
	}

	/**
	 * Destroy the file tree and cleanup
	 */
	destroy() {
		this.clear();
		this.container.classList.remove("file-tree");
	}

	/**
	 * Find an entry element by URL
	 * @param {string} url
	 * @returns {HTMLElement|null}
	 */
	findElement(url) {
		return this.container.querySelector(`[data-url="${CSS.escape(url)}"]`);
	}

	/**
	 * Refresh the current directory
	 */
	async refresh() {
		if (this.currentUrl) {
			await this.load(this.currentUrl);
		}
	}

	/**
	 * Append a new entry to the tree
	 * @param {string} name
	 * @param {string} url
	 * @param {boolean} isDirectory
	 */
	appendEntry(name, url, isDirectory) {
		const entry = { name, url, isDirectory, isFile: !isDirectory };
		const $el = this.createEntryElement(entry);

		if (isDirectory) {
			// Insert at beginning (before files)
			const firstFile = this.container.querySelector('[data-type="file"]');
			if (firstFile) {
				this.container.insertBefore($el, firstFile);
			} else {
				this.container.appendChild($el);
			}
		} else {
			// Append at end
			this.container.appendChild($el);
		}

		this.entries.push(entry);
	}

	/**
	 * Remove an entry from the tree
	 * @param {string} url
	 */
	removeEntry(url) {
		const $el = this.findElement(url);
		if ($el) {
			// For folders, remove the wrapper div
			if ($el.dataset.type === "dir") {
				$el.closest(".list.collapsible")?.remove();
			} else {
				$el.remove();
			}
			this.entries = this.entries.filter((e) => e.url !== url);
		}
	}
}
