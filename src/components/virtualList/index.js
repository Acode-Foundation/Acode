import {
	elementScroll,
	observeElementOffset,
	observeElementRect,
	Virtualizer,
} from "@tanstack/virtual-core";
import tag from "html-tag-js";
import "./style.scss";

/**
 * @typedef {object} VirtualListOptions
 * @property {number} [itemHeight=30] Fixed row height in pixels
 * @property {number} [overscan=10] Extra rows rendered above and below the viewport
 * @property {number} [activeOverscan] Rows rendered per side during interaction
 * @property {number} [maxOverscan] Maximum rows rendered per side during a fling
 * @property {function(any, number): string|number|bigint} [getItemKey] Stable item key
 * @property {function(any, HTMLElement?, number): HTMLElement} renderItem Row renderer
 */

/**
 * Small DOM adapter around TanStack Virtual's framework-agnostic core.
 *
 * TanStack owns the scroll observation and visible-range calculation. The DOM
 * adapter keeps a single stable scroll surface and incrementally recycles only
 * rows that leave the range, which is important for low-memory Android WebViews.
 */
export default class VirtualList {
	/**
	 * @param {HTMLElement} container
	 * @param {VirtualListOptions} options
	 */
	constructor(container, options = {}) {
		this.container = container;
		this.itemHeight = options.itemHeight || 30;
		this.overscan = options.overscan ?? 10;
		this.activeOverscan = Math.max(
			this.overscan,
			options.activeOverscan ?? this.overscan,
		);
		this.maxOverscan = Math.max(
			this.activeOverscan,
			options.maxOverscan ?? this.activeOverscan,
		);
		this.getItemKey = options.getItemKey || ((_item, index) => index);
		this.renderItem =
			options.renderItem ||
			((item) => tag("div", { textContent: String(item) }));
		this.items = [];
		this.pool = [];
		this.renderedRange = { start: -1, end: -1 };
		this.renderedTotalSize = -1;
		this.dynamicOverscan = this.overscan;
		this.lastScrollOffset = this.container.scrollTop;
		this.lastScrollTime = this.now();
		this.touching = false;
		this.releaseTimer = 0;
		this.destroyed = false;

		this.scrollSurface = tag("div", {
			className: "virtual-list-surface",
		});
		this.itemContainer = tag("div", {
			className: "virtual-list-items",
		});
		this.scrollSurface.append(this.itemContainer);
		this.container.append(this.scrollSurface);

		this.virtualizer = new Virtualizer(
			this.createVirtualizerOptions(this.items),
		);
		this.destroyVirtualizer = this.virtualizer._didMount();
		this.virtualizer._willUpdate();
		this.onTouchStartBound = this.onTouchStart.bind(this);
		this.onTouchEndBound = this.onTouchEnd.bind(this);
		this.container.addEventListener("touchstart", this.onTouchStartBound, {
			passive: true,
		});
		this.container.addEventListener("touchend", this.onTouchEndBound, {
			passive: true,
		});
		this.container.addEventListener("touchcancel", this.onTouchEndBound, {
			passive: true,
		});
		this.render();
	}

	/** Build a complete options object because core setOptions replaces options. */
	createVirtualizerOptions(items) {
		return {
			count: items.length,
			getScrollElement: () => this.container,
			estimateSize: () => this.itemHeight,
			getItemKey: (index) => this.getItemKey(items[index], index),
			overscan: this.overscan,
			rangeExtractor: (range) => this.extractRange(range),
			initialOffset: () => this.container.scrollTop,
			initialRect: {
				width: this.container.clientWidth,
				height: this.container.clientHeight || this.itemHeight * 10,
			},
			onChange: (virtualizer, isScrolling) =>
				this.onVirtualizerChange(virtualizer, isScrolling),
			observeElementRect,
			observeElementOffset,
			scrollToFn: elementScroll,
			// Some Android WebViews briefly pause scroll events during momentum.
			// Retain the velocity guard across those gaps instead of declaring the
			// fling settled and shrinking the painted range too early.
			isScrollingResetDelay: 300,
			// Android WebView can report ResizeObserver loop warnings when a resize
			// callback and virtual-surface mutation share a rendering step. This option
			// only defers resize processing; scroll-offset updates remain synchronous.
			useAnimationFrameWithResizeObserver: true,
		};
	}

	/** Current high-resolution timestamp without assuming a global performance. */
	now() {
		return (
			this.container.ownerDocument.defaultView?.performance?.now?.() ??
			Date.now()
		);
	}

	/** Refresh TanStack's memoized range after the guard size changes. */
	setDynamicOverscan(overscan) {
		const nextOverscan = Math.max(
			this.overscan,
			Math.min(this.maxOverscan, overscan),
		);
		if (nextOverscan === this.dynamicOverscan) return;
		this.dynamicOverscan = nextOverscan;
		if (!this.virtualizer || this.destroyed) return;
		this.virtualizer.setOptions(this.createVirtualizerOptions(this.items));
		this.virtualizer._willUpdate();
		this.render(this.virtualizer);
	}

	/** Paint the interaction guard before WebView begins compositor scrolling. */
	onTouchStart() {
		this.clearReleaseTimer();
		this.touching = true;
		this.setDynamicOverscan(this.activeOverscan);
	}

	/** Momentum scroll events keep postponing release after the finger is lifted. */
	onTouchEnd() {
		this.touching = false;
		this.scheduleRelease();
	}

	scheduleRelease() {
		this.clearReleaseTimer();
		const targetWindow = this.container.ownerDocument.defaultView;
		this.releaseTimer = targetWindow?.setTimeout(() => {
			this.releaseTimer = 0;
			if (this.destroyed || this.touching) return;
			this.setDynamicOverscan(this.overscan);
		}, 500);
	}

	clearReleaseTimer() {
		if (!this.releaseTimer) return;
		this.container.ownerDocument.defaultView?.clearTimeout(this.releaseTimer);
		this.releaseTimer = 0;
	}

	/**
	 * Keep a velocity-sized paint guard on both sides. The two-sided buffer matters
	 * because WebView can reverse compositor direction before JavaScript receives
	 * the corresponding scroll event.
	 */
	extractRange(range) {
		const start = Math.max(0, range.startIndex - this.dynamicOverscan);
		const end = Math.min(
			range.count - 1,
			range.endIndex + this.dynamicOverscan,
		);
		const indexes = new Array(Math.max(0, end - start + 1));
		for (let index = start; index <= end; index++) {
			indexes[index - start] = index;
		}
		return indexes;
	}

	/** Update predictive overscan before asking TanStack for virtual items. */
	onVirtualizerChange(virtualizer, isScrolling) {
		if (this.destroyed) return;

		const offset = virtualizer.scrollOffset ?? this.container.scrollTop;
		const time = this.now();
		if (isScrolling) {
			this.clearReleaseTimer();
			const elapsed = Math.max(8, time - this.lastScrollTime);
			const distance = Math.abs(offset - this.lastScrollOffset);
			// Project roughly two frames at the current velocity. The two-sided cap
			// keeps a violent fling below about 200 mounted rows, not the full tree.
			const projectedRows = Math.ceil(
				(distance / this.itemHeight) * (32 / elapsed),
			);
			this.dynamicOverscan = Math.min(
				this.maxOverscan,
				this.activeOverscan + projectedRows,
			);
			this.scheduleRelease();
		}

		this.lastScrollOffset = offset;
		this.lastScrollTime = time;
		this.render(virtualizer);
	}

	/** @param {Array|null|undefined} items */
	setItems(items) {
		this.items = Array.isArray(items) ? items : [];
		this.virtualizer.setOptions(this.createVirtualizerOptions(this.items));
		this.virtualizer._willUpdate();
		this.invalidate();
	}

	/** Force visible rows to be repainted. */
	invalidate() {
		this.renderedRange = { start: -1, end: -1 };
		this.render();
	}

	/** Render TanStack's current viewport range plus overscan. */
	render(virtualizer = this.virtualizer) {
		if (this.destroyed || !virtualizer) return;

		const itemCount = this.items.length;
		const totalSize = itemCount ? virtualizer.getTotalSize() : 0;
		if (totalSize !== this.renderedTotalSize) {
			this.renderedTotalSize = totalSize;
			this.scrollSurface.style.height = `${totalSize}px`;
		}

		if (!itemCount) {
			this.recycleRows();
			this.itemContainer.style.transform = "translateY(0)";
			this.renderedRange = { start: 0, end: 0 };
			return;
		}

		const virtualItems = virtualizer.getVirtualItems();
		// A hidden/collapsed pane can momentarily measure as zero. Retain the last
		// useful rows instead of flashing an empty layer; ResizeObserver will render
		// the correct range as soon as the pane has a size again.
		if (!virtualItems.length) return;

		const firstItem = virtualItems[0];
		const lastItem = virtualItems[virtualItems.length - 1];
		const start = firstItem.index;
		const end = lastItem.index + 1;

		if (start === this.renderedRange.start && end === this.renderedRange.end) {
			return;
		}

		let oldStart = this.renderedRange.start;
		let oldEnd = this.renderedRange.end;
		const rangesOverlap = oldStart < end && start < oldEnd;

		if (oldStart < 0 || !rangesOverlap) {
			this.recycleRows();
			const fragment = document.createDocumentFragment();
			for (let index = start; index < end; index++) {
				fragment.append(this.createRenderedRow(index));
			}
			this.itemContainer.append(fragment);
		} else {
			while (oldStart < start) {
				this.recycleRow(this.itemContainer.firstElementChild);
				oldStart++;
			}
			while (oldEnd > end) {
				this.recycleRow(this.itemContainer.lastElementChild);
				oldEnd--;
			}

			if (start < oldStart) {
				const leadingRows = document.createDocumentFragment();
				for (let index = start; index < oldStart; index++) {
					leadingRows.append(this.createRenderedRow(index));
				}
				this.itemContainer.insertBefore(
					leadingRows,
					this.itemContainer.firstElementChild,
				);
			}

			if (end > oldEnd) {
				const trailingRows = document.createDocumentFragment();
				for (let index = oldEnd; index < end; index++) {
					trailingRows.append(this.createRenderedRow(index));
				}
				this.itemContainer.append(trailingRows);
			}
		}

		// Translate the rendered block once, rather than positioning every row.
		// This keeps layout work small and preserves the browser's native momentum.
		this.itemContainer.style.transform = `translateY(${firstItem.start}px)`;
		this.renderedRange = { start, end };
	}

	/** Render one row, reusing a pooled element when possible. */
	createRenderedRow(index) {
		const recycled = this.pool.pop();
		const row = this.renderItem(this.items[index], recycled, index);
		row.style.height = `${this.itemHeight}px`;
		return row;
	}

	/** Detach one mounted row and return it to the pool. */
	recycleRow(row) {
		if (!row) return;
		row.remove();
		this.pool.push(row);
	}

	/** Move mounted rows into the recycling pool. */
	recycleRows() {
		while (this.itemContainer.firstElementChild) {
			this.recycleRow(this.itemContainer.firstElementChild);
		}
	}

	/** @param {number} index @param {"auto"|"start"|"center"} [align] */
	scrollToIndex(index, align = "auto") {
		if (!this.items.length) return;
		this.virtualizer.scrollToIndex(index, { align, behavior: "auto" });
	}

	getVisibleRange() {
		return { ...this.renderedRange };
	}

	destroy() {
		this.destroyed = true;
		this.clearReleaseTimer();
		this.container.removeEventListener("touchstart", this.onTouchStartBound);
		this.container.removeEventListener("touchend", this.onTouchEndBound);
		this.container.removeEventListener("touchcancel", this.onTouchEndBound);
		this.destroyVirtualizer?.();
		this.scrollSurface.remove();
		this.pool = [];
		this.items = [];
	}
}
