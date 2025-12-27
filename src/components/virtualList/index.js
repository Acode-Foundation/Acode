import "./style.scss";
import tag from "html-tag-js";

/**
 * @typedef {object} VirtualListOptions
 * @property {number} [itemHeight=30] - Height of each item in pixels
 * @property {number} [buffer=10] - Extra items to render above/below viewport
 * @property {function(any, HTMLElement?): HTMLElement} renderItem - Function to render an item
 */

/**
 * Virtual scrolling list component
 * Only renders items visible in viewport + buffer for performance
 */
export default class VirtualList {
	/**
	 * @param {HTMLElement} container
	 * @param {VirtualListOptions} options
	 */
	constructor(container, options = {}) {
		this.container = container;
		this.itemHeight = options.itemHeight || 30;
		this.buffer = options.buffer || 10;
		this.renderItem =
			options.renderItem ||
			((item) => {
				return tag("div", { textContent: String(item) });
			});

		this.items = [];
		this.renderedRange = { start: -1, end: -1 };
		this.pool = []; // DOM recycling pool

		// Create structure using html-tag-js
		this.topSpacer = tag("div", {
			className: "virtual-spacer virtual-spacer-top",
		});
		this.bottomSpacer = tag("div", {
			className: "virtual-spacer virtual-spacer-bottom",
		});
		this.itemContainer = tag("div", { className: "virtual-items" });

		this.container.append(
			this.topSpacer,
			this.itemContainer,
			this.bottomSpacer,
		);

		// Bind scroll handler with RAF throttling
		this.rafId = null;
		this.onScrollBound = this.onScroll.bind(this);
		this.container.addEventListener("scroll", this.onScrollBound, {
			passive: true,
		});
	}

	/**
	 * Set the items to render
	 * @param {Array} items
	 */
	setItems(items) {
		this.items = items;
		this.renderedRange = { start: -1, end: -1 };
		this.render();
	}

	/**
	 * Handle scroll events with RAF throttling
	 */
	onScroll() {
		if (this.rafId) return;
		this.rafId = requestAnimationFrame(() => {
			this.rafId = null;
			this.render();
		});
	}

	/**
	 * Render visible items
	 */
	render() {
		if (!this.items.length) {
			this.topSpacer.style.height = "0px";
			this.bottomSpacer.style.height = "0px";
			return;
		}

		const scrollTop = this.container.scrollTop;
		const viewportHeight = this.container.clientHeight;

		// Calculate visible range
		const startIndex = Math.max(
			0,
			Math.floor(scrollTop / this.itemHeight) - this.buffer,
		);
		const endIndex = Math.min(
			this.items.length,
			Math.ceil((scrollTop + viewportHeight) / this.itemHeight) + this.buffer,
		);

		// Skip if range hasn't changed
		if (
			startIndex === this.renderedRange.start &&
			endIndex === this.renderedRange.end
		) {
			return;
		}

		// Update spacers
		this.topSpacer.style.height = `${startIndex * this.itemHeight}px`;
		this.bottomSpacer.style.height = `${Math.max(0, (this.items.length - endIndex) * this.itemHeight)}px`;

		// Recycle existing elements
		while (this.itemContainer.firstChild) {
			const child = this.itemContainer.removeChild(
				this.itemContainer.firstChild,
			);
			this.pool.push(child);
		}

		// Render visible items using DocumentFragment
		const fragment = document.createDocumentFragment();

		for (let i = startIndex; i < endIndex; i++) {
			const item = this.items[i];
			const recycledEl = this.pool.pop();
			const el = this.renderItem(item, recycledEl);
			el.style.height = `${this.itemHeight}px`;
			fragment.appendChild(el);
		}

		this.itemContainer.appendChild(fragment);
		this.renderedRange = { start: startIndex, end: endIndex };
	}

	/**
	 * Scroll to a specific item index
	 * @param {number} index
	 */
	scrollToIndex(index) {
		this.container.scrollTop = index * this.itemHeight;
	}

	/**
	 * Get the currently visible range
	 * @returns {{start: number, end: number}}
	 */
	getVisibleRange() {
		return { ...this.renderedRange };
	}

	/**
	 * Destroy and cleanup
	 */
	destroy() {
		if (this.rafId) {
			cancelAnimationFrame(this.rafId);
			this.rafId = null;
		}
		this.container.removeEventListener("scroll", this.onScrollBound);
		this.topSpacer.remove();
		this.bottomSpacer.remove();
		this.itemContainer.remove();
		this.pool = [];
		this.items = [];
	}
}
