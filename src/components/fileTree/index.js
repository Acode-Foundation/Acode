import "./style.scss";
import tile from "components/tile";
import VirtualList from "components/virtualList";
import tag from "html-tag-js";
import helpers from "utils/helpers";
import Path from "utils/Path";

const VIRTUALIZATION_THRESHOLD = Number.POSITIVE_INFINITY; // FIX: temporary due to some scrolling issues in VirtualList
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
			return this.createFolderElement(name, entry.url, recycledEl);
		} else {
			return this.createFileElement(name, entry.url, recycledEl);
		}
	}

	/**
	 * Create folder element (collapsible)
	 * @param {string} name
	 * @param {string} url
	 * @param {HTMLElement} [recycledEl] - Optional recycled element for reuse
	 * @returns {HTMLElement}
	 */
	createFolderElement(name, url, recycledEl) {
		// Try to recycle existing folder element
		if (recycledEl && recycledEl.classList.contains("collapsible")) {
			const $title = recycledEl.$title;
			if ($title) {
				$title.dataset.url = url;
				$title.dataset.name = name;
				const textEl = $title.querySelector(".text");
				if (textEl) textEl.textContent = name;

				// Collapse if expanded and clear children
				if (!recycledEl.classList.contains("hidden")) {
					recycledEl.classList.add("hidden");
					const childTree = this.childTrees.get(recycledEl._folderUrl);
					if (childTree) {
						childTree.destroy();
						this.childTrees.delete(recycledEl._folderUrl);
					}
					recycledEl.$ul.innerHTML = "";
				}

				recycledEl._folderUrl = url;
				return recycledEl;
			}
		}

		const $wrapper = tag("div", {
			className: "list collapsible hidden",
		});
		$wrapper._folderUrl = url;

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

		// Add properties for external access (keep unclasped for collapsableList compatibility)
		Object.defineProperties($wrapper, {
			collapsed: { get: () => $wrapper.classList.contains("hidden") },
			expanded: { get: () => !$wrapper.classList.contains("hidden") },
			unclasped: { get: () => !$wrapper.classList.contains("hidden") }, // Legacy compatibility
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

		// Insert in sorted position
		if (isDirectory) {
			// Find first file or end of dirs
			const insertIndex = this.entries.findIndex((e) => !e.isDirectory);
			if (insertIndex === -1) {
				this.entries.push(entry);
			} else {
				this.entries.splice(insertIndex, 0, entry);
			}
		} else {
			this.entries.push(entry);
		}

		// Re-sort entries
		this.entries = helpers.sortDir(this.entries, {
			sortByName: true,
			showHiddenFiles: true,
		});

		// Update rendering based on mode
		if (this.virtualList) {
			// Virtual list mode: update items
			this.virtualList.setItems(this.entries);
		} else {
			// Fragment mode: re-render
			this.container.innerHTML = "";
			this.renderWithFragment();
		}
	}

	/**
	 * Remove an entry from the tree
	 * @param {string} url
	 */
	removeEntry(url) {
		// Update data first
		const index = this.entries.findIndex((e) => e.url === url);
		if (index === -1) return;

		// Clean up child tree if folder
		const entry = this.entries[index];
		if (entry.isDirectory && this.childTrees.has(url)) {
			this.childTrees.get(url).destroy();
			this.childTrees.delete(url);
		}

		// Remove from entries
		this.entries.splice(index, 1);

		// Update rendering based on mode
		if (this.virtualList) {
			// Virtual list mode: update items
			this.virtualList.setItems(this.entries);
		} else {
			// Fragment mode: remove element directly
			const $el = this.findElement(url);
			if ($el) {
				if ($el.dataset.type === "dir") {
					$el.closest(".list.collapsible")?.remove();
				} else {
					$el.remove();
				}
			}
		}
	}
}
