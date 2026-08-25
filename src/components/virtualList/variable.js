const DEFAULT_ESTIMATED_HEIGHT = 52;
const DEFAULT_OVERSCAN = 360;
const BOTTOM_THRESHOLD = 48;

/**
 * Variable-height virtual list for retained HTMLElement items.
 *
 * Every item stays in the model, while only the visible window and a small pixel
 * overscan are mounted. ResizeObserver keeps changing item heights measured
 * without losing the reader's scroll anchor.
 */
export default class VariableVirtualList {
	constructor(
		container,
		{
			estimatedHeight = DEFAULT_ESTIMATED_HEIGHT,
			overscan = DEFAULT_OVERSCAN,
			activeOverscan = overscan * 4,
			maxOverscan = overscan * 10,
			footer = null,
		} = {},
	) {
		this.container = container;
		this.estimatedHeight = estimatedHeight;
		this.overscan = overscan;
		this.activeOverscan = Math.max(overscan, activeOverscan);
		this.maxOverscan = Math.max(this.activeOverscan, maxOverscan);
		this.dynamicOverscan = overscan;
		this.footer = footer;
		this.footerHeight = 0;
		this.viewportHeight = this.container.clientHeight;
		this.items = [];
		this.itemByElement = new WeakMap();
		this.offsets = [0];
		this.offsetsDirty = false;
		this.renderedRange = { start: 0, end: 0 };
		this.frame = null;
		this.stickToBottom = true;
		this.lastScrollTop = this.container.scrollTop;
		this.lastScrollTime = this.now();
		this.touching = false;
		this.releaseTimer = null;
		this.destroyed = false;

		this.topSpacer = document.createElement("div");
		this.topSpacer.className = "variable-virtual-spacer";
		this.itemContainer = document.createElement("div");
		this.itemContainer.className = "variable-virtual-items";
		this.bottomSpacer = document.createElement("div");
		this.bottomSpacer.className = "variable-virtual-spacer";
		this.container.append(
			this.topSpacer,
			this.itemContainer,
			this.bottomSpacer,
		);
		if (this.footer) this.container.append(this.footer);

		this.onScroll = () => {
			this.stickToBottom = this.isNearBottom();
			const now = this.now();
			const elapsed = Math.max(8, now - this.lastScrollTime);
			const distance = Math.abs(this.container.scrollTop - this.lastScrollTop);
			const projectedDistance = distance * (32 / elapsed);
			this.dynamicOverscan = Math.min(
				this.maxOverscan,
				this.activeOverscan + projectedDistance * 2,
			);
			this.lastScrollTop = this.container.scrollTop;
			this.lastScrollTime = now;
			// Scroll rendering is intentionally synchronous. Android WebView can move
			// the compositor several rows before the next animation frame.
			this.render();
			this.scheduleOverscanRelease();
		};
		this.onTouchStart = () => {
			this.touching = true;
			this.clearOverscanRelease();
			this.dynamicOverscan = this.activeOverscan;
			// Pre-paint the fling guard before compositor scrolling begins.
			this.render();
		};
		this.onTouchEnd = () => {
			this.touching = false;
			this.scheduleOverscanRelease();
		};
		this.container.addEventListener("scroll", this.onScroll, { passive: true });
		this.container.addEventListener("touchstart", this.onTouchStart, {
			passive: true,
		});
		this.container.addEventListener("touchend", this.onTouchEnd, {
			passive: true,
		});
		this.container.addEventListener("touchcancel", this.onTouchEnd, {
			passive: true,
		});

		this.resizeObserver =
			typeof ResizeObserver === "function"
				? new ResizeObserver((entries) => this.onResize(entries))
				: null;
		this.resizeObserver?.observe(this.container);
	}

	now() {
		return (
			this.container.ownerDocument.defaultView?.performance?.now?.() ??
			Date.now()
		);
	}

	scheduleOverscanRelease() {
		this.clearOverscanRelease();
		this.releaseTimer = this.container.ownerDocument.defaultView?.setTimeout(
			() => {
				this.releaseTimer = null;
				if (this.destroyed || this.touching) return;
				this.dynamicOverscan = this.overscan;
				this.render();
			},
			500,
		);
	}

	clearOverscanRelease() {
		if (this.releaseTimer === null) return;
		this.container.ownerDocument.defaultView?.clearTimeout(this.releaseTimer);
		this.releaseTimer = null;
	}

	get length() {
		return this.items.length;
	}

	get mountedCount() {
		return this.itemContainer.childElementCount;
	}

	append(element) {
		const wasNearBottom = this.isNearBottom();
		const item = {
			element,
			height: this.estimatedHeight,
			index: this.items.length,
		};
		this.items.push(item);
		this.itemByElement.set(element, item);
		this.offsetsDirty = true;
		if (wasNearBottom || this.items.length === 1) this.stickToBottom = true;
		this.scheduleRender();
	}

	clear() {
		this.items = [];
		this.itemByElement = new WeakMap();
		this.offsets = [0];
		this.offsetsDirty = false;
		this.renderedRange = { start: 0, end: 0 };
		this.stickToBottom = true;
		this.dynamicOverscan = this.overscan;
		this.topSpacer.style.height = "0px";
		this.bottomSpacer.style.height = "0px";
		this.itemContainer.replaceChildren();
		this.container.scrollTop = 0;
		this.footerHeight = this.getFooterHeight();
		this.observeResizeTargets();
	}

	invalidate() {
		this.scheduleRender();
	}

	scrollToBottom() {
		this.stickToBottom = true;
		this.scheduleRender();
	}

	scheduleRender() {
		if (this.frame !== null || this.destroyed) return;
		this.frame = requestAnimationFrame(() => {
			this.frame = null;
			this.render();
		});
	}

	rebuildOffsets() {
		if (!this.offsetsDirty) return;

		const offsets = new Array(this.items.length + 1);
		offsets[0] = 0;
		for (let index = 0; index < this.items.length; index++) {
			offsets[index + 1] = offsets[index] + this.items[index].height;
		}
		this.offsets = offsets;
		this.offsetsDirty = false;
	}

	findIndexAt(offset) {
		let low = 0;
		let high = this.items.length;
		while (low < high) {
			const middle = Math.floor((low + high + 1) / 2);
			if (this.offsets[middle] <= offset) low = middle;
			else high = middle - 1;
		}
		return Math.min(low, Math.max(0, this.items.length - 1));
	}

	getFooterHeight() {
		if (!this.footer) return 0;
		return Math.ceil(
			this.footer.getBoundingClientRect().height ||
				this.footer.offsetHeight ||
				0,
		);
	}

	observeResizeTargets() {
		if (!this.resizeObserver) return;
		this.resizeObserver.disconnect();
		this.resizeObserver.observe(this.container);
		for (const element of this.itemContainer.children) {
			this.resizeObserver.observe(element);
		}
		if (this.footer) this.resizeObserver.observe(this.footer);
	}

	render() {
		if (this.destroyed) return;
		this.rebuildOffsets();
		if (!this.items.length) {
			this.footerHeight = this.getFooterHeight();
			this.itemContainer.replaceChildren();
			this.topSpacer.style.height = "0px";
			this.bottomSpacer.style.height = "0px";
			this.renderedRange = { start: 0, end: 0 };
			this.observeResizeTargets();
			return;
		}

		const viewportHeight = Math.max(
			1,
			this.container.clientHeight || window.innerHeight,
		);
		this.viewportHeight = viewportHeight;
		const totalHeight = this.offsets[this.items.length];
		this.footerHeight = this.getFooterHeight();
		const targetScrollTop = this.stickToBottom
			? Math.max(0, totalHeight + this.footerHeight - viewportHeight)
			: this.container.scrollTop;
		const start = this.findIndexAt(
			Math.max(0, targetScrollTop - this.dynamicOverscan),
		);
		const end = Math.min(
			this.items.length,
			this.findIndexAt(
				targetScrollTop + viewportHeight + this.dynamicOverscan,
			) + 1,
		);

		this.updateMountedRange(start, end);
		this.observeResizeTargets();
		this.topSpacer.style.height = `${this.offsets[start]}px`;
		this.bottomSpacer.style.height = `${Math.max(
			0,
			totalHeight - this.offsets[end],
		)}px`;
		this.renderedRange = { start, end };

		if (this.stickToBottom) {
			this.container.scrollTop = Math.max(
				0,
				this.container.scrollHeight - viewportHeight,
			);
		}
		if (!this.resizeObserver) this.measureMountedItems();
	}

	updateMountedRange(start, end) {
		let oldStart = this.renderedRange.start;
		let oldEnd = this.renderedRange.end;
		const rangesOverlap = oldStart < end && start < oldEnd;

		if (!this.itemContainer.childElementCount || !rangesOverlap) {
			const fragment = document.createDocumentFragment();
			for (let index = start; index < end; index++) {
				fragment.append(this.items[index].element);
			}
			this.itemContainer.replaceChildren(fragment);
			return;
		}

		while (oldStart < start) {
			this.itemContainer.firstElementChild?.remove();
			oldStart++;
		}
		while (oldEnd > end) {
			this.itemContainer.lastElementChild?.remove();
			oldEnd--;
		}

		if (start < oldStart) {
			const leading = document.createDocumentFragment();
			for (let index = start; index < oldStart; index++) {
				leading.append(this.items[index].element);
			}
			this.itemContainer.insertBefore(leading, this.itemContainer.firstChild);
		}
		if (end > oldEnd) {
			const trailing = document.createDocumentFragment();
			for (let index = oldEnd; index < end; index++) {
				trailing.append(this.items[index].element);
			}
			this.itemContainer.append(trailing);
		}
	}

	measureMountedItems() {
		for (const element of this.itemContainer.children) {
			const item = this.itemByElement.get(element);
			if (item) this.updateHeight(item, element.getBoundingClientRect().height);
		}
	}

	onResize(entries) {
		const wasNearBottom = this.stickToBottom || this.isNearBottom();
		let footerChanged = false;
		let viewportChanged = false;
		for (const entry of entries) {
			if (entry.target === this.container) {
				const borderBox = Array.isArray(entry.borderBoxSize)
					? entry.borderBoxSize[0]
					: entry.borderBoxSize;
				const height = Math.ceil(
					borderBox?.blockSize ||
						entry.contentRect?.height ||
						this.container.clientHeight,
				);
				viewportChanged = Math.abs(height - this.viewportHeight) >= 1;
				this.viewportHeight = height;
				continue;
			}
			if (entry.target === this.footer) {
				const borderBox = Array.isArray(entry.borderBoxSize)
					? entry.borderBoxSize[0]
					: entry.borderBoxSize;
				const height = Math.ceil(
					borderBox?.blockSize ||
						entry.contentRect?.height ||
						this.getFooterHeight(),
				);
				footerChanged = Math.abs(height - this.footerHeight) >= 1;
				this.footerHeight = height;
				continue;
			}
			const item = this.itemByElement.get(entry.target);
			if (!item) continue;
			const borderBox = Array.isArray(entry.borderBoxSize)
				? entry.borderBoxSize[0]
				: entry.borderBoxSize;
			this.updateHeight(
				item,
				borderBox?.blockSize ||
					entry.contentRect?.height ||
					entry.target.offsetHeight,
			);
		}
		if (wasNearBottom) this.stickToBottom = true;
		if (viewportChanged || (wasNearBottom && footerChanged)) {
			this.scheduleRender();
		}
	}

	updateHeight(item, measuredHeight) {
		const height = Math.max(1, Math.ceil(measuredHeight || 0));
		if (Math.abs(height - item.height) < 1) return;

		const delta = height - item.height;
		item.height = height;
		this.offsetsDirty = true;
		if (!this.stickToBottom && item.index < this.renderedRange.start) {
			this.container.scrollTop += delta;
		}
		this.scheduleRender();
	}

	isNearBottom() {
		if (!this.items.length) return true;
		return (
			this.container.scrollHeight -
				this.container.scrollTop -
				this.container.clientHeight <=
			BOTTOM_THRESHOLD
		);
	}

	destroy() {
		this.destroyed = true;
		if (this.frame !== null) cancelAnimationFrame(this.frame);
		this.frame = null;
		this.clearOverscanRelease();
		this.resizeObserver?.disconnect();
		this.container.removeEventListener("scroll", this.onScroll);
		this.container.removeEventListener("touchstart", this.onTouchStart);
		this.container.removeEventListener("touchend", this.onTouchEnd);
		this.container.removeEventListener("touchcancel", this.onTouchEnd);
		this.topSpacer.remove();
		this.itemContainer.remove();
		this.bottomSpacer.remove();
		this.items = [];
	}
}
