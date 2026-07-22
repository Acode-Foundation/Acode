import "./style.scss";
import tile from "components/tile";
import VirtualList from "components/virtualList";
import tag from "html-tag-js";
import { animate } from "motion";
import helpers from "utils/helpers";
import Path from "utils/Path";

const ITEM_HEIGHT = 30;
const IDLE_OVERSCAN_ROWS = 32;
const ACTIVE_OVERSCAN_ROWS = 64;
const MAX_FLING_OVERSCAN_ROWS = 96;

/**
 * @typedef {object} FileTreeOptions
 * @property {function(string): Promise<Array>} getEntries
 * @property {function(string, string): void} [onFileClick]
 * @property {function(string, string, string, HTMLElement): void} [onContextMenu]
 * @property {Object<string, boolean>|Map<string, boolean>} [expandedState]
 * @property {function(string, boolean): void} [onExpandedChange]
 * @property {function(any): void} [onError]
 */

/**
 * A lazy, fully virtualized file tree.
 *
 * Directory data stays hierarchical, but rendering uses one flattened array of
 * visible nodes. Consequently every row has a stable fixed offset regardless of
 * nesting, and only the viewport plus a small overscan window exists in the DOM.
 */
export default class FileTree {
	/**
	 * @param {HTMLElement} container
	 * @param {FileTreeOptions} options
	 */
	constructor(container, options = {}) {
		this.container = container;
		this.options = options;
		this.entries = [];
		this.visibleEntries = [];
		this.visibleIndexByUrl = new Map();
		this.nodes = new Map();
		this.currentUrl = null;
		this.focusedUrl = null;
		this.selectedUrl = null;
		this.cutUrl = null;
		this.loadGeneration = 0;
		this.pendingDirectoryLoads = [];
		this.activeDirectoryLoads = 0;
		this.maxConcurrentDirectoryLoads = 4;
		this.iconAnimations = new WeakMap();
		this.destroyed = false;

		this.container.classList.add("file-tree", "virtual-scroll");
		this.container.setAttribute("role", "tree");
		this.container.setAttribute("aria-label", "Files");
		this.container._fileTree = this;

		this.onClickBound = this.onClick.bind(this);
		this.onContextMenuBound = this.onContextMenu.bind(this);
		this.onKeyDownBound = this.onKeyDown.bind(this);
		this.container.addEventListener("click", this.onClickBound);
		this.container.addEventListener("contextmenu", this.onContextMenuBound);
		this.container.addEventListener("keydown", this.onKeyDownBound);

		this.virtualList = new VirtualList(this.container, {
			itemHeight: ITEM_HEIGHT,
			overscan: IDLE_OVERSCAN_ROWS,
			activeOverscan: ACTIVE_OVERSCAN_ROWS,
			maxOverscan: MAX_FLING_OVERSCAN_ROWS,
			getItemKey: (entry) => entry.url,
			renderItem: (entry, recycledEl) => this.renderEntry(entry, recycledEl),
		});
		this.virtualList.scrollSurface.setAttribute("role", "presentation");
		this.virtualList.itemContainer.setAttribute("role", "presentation");
	}

	/** Load the root directory. @param {string} url */
	async load(url) {
		const generation = ++this.loadGeneration;
		this.cancelPendingDirectoryLoads();
		this.currentUrl = url;
		// FTP and SFTP clients use a single stateful connection. Concurrent list
		// commands can corrupt the data channel and return a null native array.
		this.maxConcurrentDirectoryLoads = /^(ftp|sftp):/i.test(url) ? 1 : 4;
		this.container.scrollTop = 0;
		this.resetData();
		this.container.setAttribute("aria-busy", "true");

		try {
			const entries = await this.options.getEntries(url);
			if (this.destroyed || generation !== this.loadGeneration) return;
			this.entries = this.reconcileChildren(url, 0, entries, []);
			this.rebuildVisibleEntries();
			this.loadRestoredFolders(this.entries);
		} finally {
			if (!this.destroyed && generation === this.loadGeneration) {
				this.container.removeAttribute("aria-busy");
			}
		}
	}

	/** Sort directory entries using the same ordering as the rest of Acode. */
	sortEntries(entries) {
		if (!Array.isArray(entries)) return [];
		return helpers.sortDir(entries, {
			sortByName: true,
			showHiddenFiles: true,
		});
	}

	/** Read persisted expanded state from either a Map or a plain object. */
	isPersistedExpanded(url) {
		const state = this.options.expandedState;
		return state instanceof Map
			? state.get(url) === true
			: state?.[url] === true;
	}

	/**
	 * Reconcile a directory listing while retaining loaded subtrees for unchanged
	 * folders. This makes refreshes cheap and keeps expansion stable.
	 */
	reconcileChildren(parentUrl, depth, rawEntries, previousChildren) {
		const previousByUrl = new Map(
			(previousChildren || []).map((entry) => [entry.url, entry]),
		);
		const nextChildren = this.sortEntries(rawEntries).map((entry) => {
			const url = entry.url;
			const name = entry.name || Path.basename(url);
			const isDirectory = Boolean(entry.isDirectory);
			let node = previousByUrl.get(url);

			if (node && node.isDirectory === isDirectory) {
				node.name = name;
				node.depth = depth;
				node.parentUrl = parentUrl;
				previousByUrl.delete(url);
			} else {
				if (node) this.removeNode(node);
				node = {
					name,
					url,
					isDirectory,
					isFile: !isDirectory,
					parentUrl,
					depth,
					children: null,
					expanded: isDirectory && this.isPersistedExpanded(url),
					loading: false,
					loadGeneration: 0,
				};
			}

			this.nodes.set(url, node);
			return node;
		});

		for (const removedNode of previousByUrl.values()) {
			this.removeNode(removedNode);
		}

		nextChildren.forEach((node, index) => {
			node.position = index + 1;
			node.setSize = nextChildren.length;
		});
		return nextChildren;
	}

	/** Remove a node and every retained descendant from the model. */
	removeNode(node) {
		node.loadGeneration++;
		for (const child of node.children || []) this.removeNode(child);
		this.nodes.delete(node.url);
	}

	/** Flatten only expanded nodes into the render list. */
	rebuildVisibleEntries() {
		const oldIndex = Math.floor(this.container.scrollTop / ITEM_HEIGHT);
		const anchor = this.visibleEntries[oldIndex];
		const anchorOffset = this.container.scrollTop - oldIndex * ITEM_HEIGHT;
		const visible = [];
		const visibleIndexByUrl = new Map();

		const append = (entries) => {
			for (const entry of entries) {
				visibleIndexByUrl.set(entry.url, visible.length);
				visible.push(entry);
				if (entry.isDirectory && entry.expanded && entry.children) {
					append(entry.children);
				}
			}
		};
		append(this.entries);
		this.visibleEntries = visible;
		this.visibleIndexByUrl = visibleIndexByUrl;
		if (!visibleIndexByUrl.has(this.focusedUrl)) {
			this.focusedUrl = visible[0]?.url || null;
		}
		this.virtualList.setItems(visible);

		// Keep the first visible row anchored when async children are inserted above
		// it. This prevents the jump that is especially noticeable during touch scroll.
		if (anchor) {
			const nextIndex = visibleIndexByUrl.get(anchor.url);
			if (nextIndex !== undefined && nextIndex !== oldIndex) {
				this.container.scrollTop = nextIndex * ITEM_HEIGHT + anchorOffset;
				this.virtualList.invalidate();
			}
		}
	}

	/** Begin lazy loading folders restored as expanded. */
	loadRestoredFolders(entries) {
		for (const entry of entries) {
			if (entry.isDirectory && entry.expanded) this.ensureChildren(entry);
		}
	}

	/** Load a directory once and reveal its children when ready. */
	async ensureChildren(node, priority = false) {
		if (!node?.isDirectory || node.children || node.loading || this.destroyed) {
			return;
		}

		const generation = ++node.loadGeneration;
		node.loading = true;
		this.virtualList.invalidate();

		try {
			const entries = await this.requestDirectoryEntries(node.url, priority);
			if (
				this.destroyed ||
				generation !== node.loadGeneration ||
				this.nodes.get(node.url) !== node
			) {
				return;
			}

			node.children = this.reconcileChildren(
				node.url,
				node.depth + 1,
				entries,
				[],
			);
			node.loading = false;
			this.rebuildVisibleEntries();
			this.loadRestoredFolders(node.children);
		} catch (error) {
			if (generation !== node.loadGeneration || this.destroyed) return;
			node.loading = false;
			node.expanded = false;
			this.options.onExpandedChange?.(node.url, false);
			this.rebuildVisibleEntries();
			this.options.onError?.(error);
		}
	}

	/**
	 * Bound directory reads so restoring a large saved tree cannot flood Cordova's
	 * bridge. Interactive expansions are placed ahead of background restoration.
	 */
	requestDirectoryEntries(url, priority = false) {
		return new Promise((resolve, reject) => {
			const job = { url, resolve, reject };
			if (priority) this.pendingDirectoryLoads.unshift(job);
			else this.pendingDirectoryLoads.push(job);
			this.pumpDirectoryLoads();
		});
	}

	pumpDirectoryLoads() {
		while (
			!this.destroyed &&
			this.activeDirectoryLoads < this.maxConcurrentDirectoryLoads &&
			this.pendingDirectoryLoads.length
		) {
			const job = this.pendingDirectoryLoads.shift();
			this.activeDirectoryLoads++;
			Promise.resolve()
				.then(() => this.options.getEntries(job.url))
				.then(job.resolve, job.reject)
				.finally(() => {
					this.activeDirectoryLoads--;
					this.pumpDirectoryLoads();
				});
		}
	}

	cancelPendingDirectoryLoads() {
		for (const job of this.pendingDirectoryLoads.splice(0)) {
			job.resolve(null);
		}
	}

	/** @param {object} entry @param {HTMLElement} [recycledEl] */
	renderEntry(entry, recycledEl) {
		const row = recycledEl || this.createRow();
		const icon = row.firstElementChild;
		const text = row.children[1];
		this.resetIconAnimation(icon);

		row.dataset.url = entry.url;
		row.dataset.name = entry.name;
		row.dataset.type = entry.isDirectory ? "dir" : "file";
		row.style.setProperty("--file-tree-depth", entry.depth);
		row.setAttribute("aria-level", String(entry.depth + 1));
		row.setAttribute("aria-posinset", String(entry.position));
		row.setAttribute("aria-setsize", String(entry.setSize));
		row.setAttribute("aria-selected", String(this.selectedUrl === entry.url));
		row.tabIndex = this.focusedUrl === entry.url ? 0 : -1;
		row.classList.toggle("loading", entry.loading);
		row.classList.toggle("cut", this.cutUrl === entry.url);

		if (entry.isDirectory) {
			row.setAttribute("aria-expanded", String(entry.expanded));
			row.setAttribute("aria-busy", String(entry.loading));
			icon.className = "icon folder";
		} else {
			row.removeAttribute("aria-expanded");
			row.removeAttribute("aria-busy");
			icon.className = helpers.getIconForFile(entry.name);
		}

		text.textContent = entry.name;
		return row;
	}

	/** Stop an animation before its recycled icon is rebound to another entry. */
	resetIconAnimation(icon) {
		const animation = this.iconAnimations.get(icon);
		if (animation) {
			animation.cancel?.();
			this.iconAnimations.delete(icon);
		}
		icon.style.removeProperty("opacity");
		icon.style.removeProperty("transform");
	}

	/** Animate only the small folder glyph, using compositor-only properties. */
	animateFolderToggle(url) {
		if (document.body.classList.contains("no-animation")) return;
		const icon = this.findElement(url)?.firstElementChild;
		if (!icon) return;

		this.resetIconAnimation(icon);
		const animation = animate(
			icon,
			{
				opacity: [0.65, 1],
				transform: ["scale(0.88)", "scale(1)"],
			},
			{ duration: 0.14, ease: [0.2, 0, 0, 1] },
		);
		this.iconAnimations.set(icon, animation);
		const cleanup = () => {
			if (this.iconAnimations.get(icon) !== animation) return;
			this.iconAnimations.delete(icon);
			icon.style.removeProperty("opacity");
			icon.style.removeProperty("transform");
		};
		animation.then(cleanup).catch(cleanup);
	}

	createRow() {
		const row = tile({
			lead: tag("span", { className: "icon" }),
			type: "li",
			text: "",
		});
		row.classList.add("file-tree-row");
		row.setAttribute("role", "treeitem");
		return row;
	}

	/** Resolve a delegated event to its mounted row. */
	getEventRow(event) {
		const target = event.target;
		if (!(target instanceof Element)) return null;
		const row = target.closest(".file-tree-row");
		return row && this.container.contains(row) ? row : null;
	}

	onClick(event) {
		const row = this.getEventRow(event);
		if (!row) return;
		event.stopPropagation();
		this.focusedUrl = row.dataset.url;
		const entry = this.nodes.get(row.dataset.url);
		if (!entry) return;

		if (entry.isDirectory) {
			this.toggle(entry.url);
		} else {
			this.selectedUrl = entry.url;
			this.virtualList.invalidate();
			this.options.onFileClick?.(entry.url, entry.name);
		}
	}

	onContextMenu(event) {
		const row = this.getEventRow(event);
		if (!row) return;
		event.preventDefault();
		event.stopPropagation();
		const entry = this.nodes.get(row.dataset.url);
		if (!entry) return;
		this.options.onContextMenu?.(
			entry.isDirectory ? "dir" : "file",
			entry.url,
			entry.name,
			row,
		);
	}

	onKeyDown(event) {
		const row = this.getEventRow(event);
		if (!row) return;
		const index = this.visibleIndexByUrl.get(row.dataset.url);
		if (index === undefined) return;
		const entry = this.visibleEntries[index];
		let destination = -1;

		switch (event.key) {
			case "ArrowDown":
				destination = Math.min(index + 1, this.visibleEntries.length - 1);
				break;
			case "ArrowUp":
				destination = Math.max(index - 1, 0);
				break;
			case "ArrowRight":
				if (entry.isDirectory && !entry.expanded) this.toggle(entry.url, true);
				else if (entry.children?.length) destination = index + 1;
				break;
			case "ArrowLeft":
				if (entry.isDirectory && entry.expanded) this.toggle(entry.url, false);
				else if (entry.parentUrl !== this.currentUrl) {
					destination = this.visibleIndexByUrl.get(entry.parentUrl) ?? -1;
				}
				break;
			case "Enter":
			case " ":
				if (entry.isDirectory) this.toggle(entry.url);
				else this.options.onFileClick?.(entry.url, entry.name);
				break;
			default:
				return;
		}

		event.preventDefault();
		event.stopPropagation();
		if (destination !== -1) this.focusEntryAt(destination);
	}

	focusEntryAt(index) {
		const entry = this.visibleEntries[index];
		if (!entry) return;
		this.focusedUrl = entry.url;
		this.virtualList.scrollToIndex(index);
		requestAnimationFrame(() => {
			const row = this.findElement(entry.url);
			if (!row) return;
			try {
				row.focus({ preventScroll: true });
			} catch {
				row.focus();
			}
		});
	}

	/** Expand or collapse one directory. */
	toggle(url, force) {
		const entry = this.nodes.get(url);
		if (!entry?.isDirectory) return;
		const expanded = force ?? !entry.expanded;
		if (entry.expanded === expanded) return;
		entry.expanded = expanded;
		this.options.onExpandedChange?.(url, expanded);
		this.rebuildVisibleEntries();
		if (expanded) this.ensureChildren(entry, true);
		this.animateFolderToggle(url);
	}

	findElement(url) {
		for (const row of this.virtualList.itemContainer.children) {
			if (row.dataset.url === url) return row;
		}
		return null;
	}

	hasEntry(url) {
		return url === this.currentUrl || this.nodes.has(url);
	}

	isExpanded(url) {
		if (url === this.currentUrl) return true;
		return this.nodes.get(url)?.expanded === true;
	}

	setCut(url, isCut) {
		this.cutUrl = isCut ? url : this.cutUrl === url ? null : this.cutUrl;
		this.virtualList.invalidate();
	}

	async refresh() {
		if (!this.currentUrl) return;
		const url = this.currentUrl;
		const generation = ++this.loadGeneration;
		const entries = await this.requestDirectoryEntries(url, true);
		if (
			this.destroyed ||
			generation !== this.loadGeneration ||
			url !== this.currentUrl
		) {
			return;
		}
		this.entries = this.reconcileChildren(url, 0, entries, this.entries);
		this.rebuildVisibleEntries();
		this.loadRestoredFolders(this.entries);
	}

	/** Refresh a directory that has already been loaded in this model. */
	async refreshFolder(url, isSameUrl = (a, b) => a === b) {
		if (this.currentUrl && isSameUrl(this.currentUrl, url)) {
			await this.refresh();
			return true;
		}

		const exactNode = this.nodes.get(url);
		const node = exactNode?.isDirectory
			? exactNode
			: Array.from(this.nodes.values()).find(
					(entry) => entry.isDirectory && isSameUrl(entry.url, url),
				);
		if (!node || (!node.children && !node.expanded)) return false;

		const generation = ++node.loadGeneration;
		node.loading = true;
		this.virtualList.invalidate();
		try {
			const entries = await this.requestDirectoryEntries(node.url, true);
			if (this.destroyed || generation !== node.loadGeneration) return false;
			node.children = this.reconcileChildren(
				node.url,
				node.depth + 1,
				entries,
				node.children || [],
			);
			this.loadRestoredFolders(node.children);
			return true;
		} finally {
			if (!this.destroyed && generation === node.loadGeneration) {
				node.loading = false;
				this.rebuildVisibleEntries();
			}
		}
	}

	/**
	 * Append an entry to a loaded directory.
	 * @returns {boolean} Whether the directory was present and loaded
	 */
	appendEntry(parentUrl, name, url, isDirectory) {
		// Backward compatibility with the old root-only signature.
		if (arguments.length === 3) {
			isDirectory = url;
			url = name;
			name = parentUrl;
			parentUrl = this.currentUrl;
		}

		let children;
		let parentNode = null;
		if (parentUrl === this.currentUrl) children = this.entries;
		else {
			parentNode = this.nodes.get(parentUrl);
			children = parentNode?.children;
		}
		if (!children || children.some((entry) => entry.url === url)) return false;

		const rawEntries = children.map((entry) => ({ ...entry }));
		rawEntries.push({ name, url, isDirectory, isFile: !isDirectory });
		const reconciled = this.reconcileChildren(
			parentUrl,
			parentNode ? parentNode.depth + 1 : 0,
			rawEntries,
			children,
		);
		if (parentNode) parentNode.children = reconciled;
		else this.entries = reconciled;
		this.rebuildVisibleEntries();
		return true;
	}

	/** Remove an entry from whichever loaded directory owns it. */
	removeEntry(url) {
		const node = this.nodes.get(url);
		if (!node) return false;
		const parent = this.nodes.get(node.parentUrl);
		const siblings = parent ? parent.children : this.entries;
		const index = siblings?.findIndex((entry) => entry.url === url) ?? -1;
		if (index === -1) return false;
		siblings.splice(index, 1);
		this.removeNode(node);
		siblings.forEach((entry, siblingIndex) => {
			entry.position = siblingIndex + 1;
			entry.setSize = siblings.length;
		});
		this.rebuildVisibleEntries();
		return true;
	}

	resetData() {
		for (const entry of this.entries) this.removeNode(entry);
		this.entries = [];
		this.visibleEntries = [];
		this.visibleIndexByUrl.clear();
		this.nodes.clear();
		this.virtualList.setItems([]);
	}

	clear() {
		this.loadGeneration++;
		this.cancelPendingDirectoryLoads();
		this.resetData();
	}

	destroy() {
		if (this.destroyed) return;
		this.destroyed = true;
		this.clear();
		this.virtualList.destroy();
		this.container.removeEventListener("click", this.onClickBound);
		this.container.removeEventListener("contextmenu", this.onContextMenuBound);
		this.container.removeEventListener("keydown", this.onKeyDownBound);
		this.container.classList.remove("file-tree", "virtual-scroll");
		this.container.removeAttribute("role");
		this.container.removeAttribute("aria-label");
		this.container.removeAttribute("aria-busy");
		if (this.container._fileTree === this) this.container._fileTree = null;
	}
}
