// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import VariableVirtualList from "components/virtualList/variable";

function createList() {
	const container = document.createElement("div");
	Object.defineProperty(container, "clientHeight", {
		configurable: true,
		value: 200,
	});
	document.body.append(container);
	return { container, list: new VariableVirtualList(container) };
}

describe("VariableVirtualList", () => {
	it.each([
		0, 360,
	])("covers jumps, reversals, and list edges with %i pixel overscan", (overscan) => {
		const container = document.createElement("div");
		Object.defineProperties(container, {
			clientHeight: { value: 200 },
			scrollHeight: { value: 52000 },
		});
		document.body.append(container);
		const list = new VariableVirtualList(container, { overscan });
		for (let i = 0; i < 1000; i++) list.append(document.createElement("div"));
		for (const offset of [0, 10, 10000, 12000, 11999, 500, 51800, 40000, 0]) {
			container.scrollTop = offset;
			list.onScroll();
			expect(list.offsets[list.renderedRange.start]).toBeLessThanOrEqual(
				container.scrollTop,
			);
			expect(list.offsets[list.renderedRange.end]).toBeGreaterThanOrEqual(
				container.scrollTop + 200,
			);
		}
		list.clear();
		expect(list.scrollDirection).toBe(0);
		list.destroy();
		container.remove();
	});

	it("extends clean offsets without reading previous message heights", () => {
		const { container, list } = createList();
		for (let i = 0; i < 100; i++) list.append(document.createElement("div"));
		const offsets = list.offsets;
		const heightRead = vi.fn(() => 52);
		for (const item of list.items)
			Object.defineProperty(item, "height", { get: heightRead });
		for (let i = 0; i < 100; i++) list.append(document.createElement("div"));
		list.rebuildOffsets();
		expect(heightRead).not.toHaveBeenCalled();
		expect(list.offsets).toBe(offsets);
		expect(list.offsets).toHaveLength(201);
		expect(list.offsets[200]).toBe(10400);
		list.destroy();
		container.remove();
	});

	it("reconciles appended offsets after height changes and after clearing", () => {
		const { container, list } = createList();
		list.append(document.createElement("div"));
		list.append(document.createElement("div"));
		list.updateHeight(list.items[0], 100);
		list.append(document.createElement("div"));
		list.append(document.createElement("div"));
		list.rebuildOffsets();
		expect(list.offsets).toEqual([0, 100, 152, 204, 256]);
		list.append(document.createElement("div"));
		expect(list.offsets).toEqual([0, 100, 152, 204, 256, 308]);
		list.clear();
		list.append(document.createElement("div"));
		expect(list.offsets).toEqual([0, 52]);
		list.destroy();
		container.remove();
	});

	it("moves overscan ahead of scrolling and refills immediately on reversal", () => {
		const { container, list } = createList();
		Object.defineProperty(container, "scrollHeight", { value: 52000 });
		for (let i = 0; i < 1000; i++) list.append(document.createElement("div"));
		list.stickToBottom = false;
		container.scrollTop = 20000;
		list.onTouchStart();
		const symmetricCount = list.mountedCount;
		vi.spyOn(list, "now").mockReturnValue(list.lastScrollTime + 32);
		const margins = () => ({
			before: container.scrollTop - list.offsets[list.renderedRange.start],
			after:
				list.offsets[list.renderedRange.end] -
				container.scrollTop -
				container.clientHeight,
		});
		container.scrollTop += 10;
		list.onScroll();
		expect(margins().after).toBeGreaterThan(margins().before * 2);
		expect(list.mountedCount).toBeLessThan(symmetricCount);
		const mounted = vi.spyOn(list, "updateMountedRange");
		container.scrollTop -= 10;
		list.onScroll();
		expect(mounted).toHaveBeenCalledOnce();
		expect(margins().before).toBeGreaterThan(margins().after * 2);
		expect(margins().after).toBeGreaterThanOrEqual(list.overscan);
		list.onTouchStart();
		expect(Math.abs(margins().before - margins().after)).toBeLessThan(52);
		list.destroy();
		container.remove();
	});

	it("retains resize observations for overlapping rows and releases removed rows", () => {
		const { container, list } = createList();
		const observe = vi.spyOn(list.resizeObserver, "observe");
		const unobserve = vi.spyOn(list.resizeObserver, "unobserve");
		const disconnect = vi.spyOn(list.resizeObserver, "disconnect");
		for (let index = 0; index < 200; index++) {
			list.append(document.createElement("div"));
		}
		list.stickToBottom = false;
		container.scrollTop = 1000;
		list.render();
		const previous = new Set(list.itemContainer.children);
		observe.mockClear();

		list.render();
		expect(observe).not.toHaveBeenCalled();
		expect(unobserve).not.toHaveBeenCalled();
		expect(disconnect).not.toHaveBeenCalled();

		container.scrollTop += 104;
		list.render();
		const current = new Set(list.itemContainer.children);
		expect(observe.mock.calls.map(([element]) => element)).toEqual(
			[...current].filter((element) => !previous.has(element)),
		);
		expect(unobserve.mock.calls.map(([element]) => element)).toEqual(
			[...previous].filter((element) => !current.has(element)),
		);
		unobserve.mockClear();
		list.clear();
		expect(unobserve).toHaveBeenCalledTimes(current.size);
		list.destroy();
		container.remove();
	});

	it("leaves buffered rows untouched until the viewport approaches their edge", () => {
		const { container, list } = createList();
		Object.defineProperty(container, "scrollHeight", { value: 52000 });
		for (let index = 0; index < 1000; index++) {
			list.append(document.createElement("div"));
		}
		list.stickToBottom = false;
		container.scrollTop = 10000;
		list.onScroll();
		list.onTouchStart();
		container.scrollTop += 20;
		list.onScroll();
		const mounted = vi.spyOn(list, "updateMountedRange");
		const initialRange = { ...list.renderedRange };
		container.scrollTop += 20;
		list.onScroll();
		expect(mounted).not.toHaveBeenCalled();
		expect(list.renderedRange).toEqual(initialRange);

		container.scrollTop += 2000;
		list.onScroll();
		expect(mounted).toHaveBeenCalledOnce();
		expect(list.offsets[list.renderedRange.start]).toBeLessThan(
			container.scrollTop,
		);
		expect(list.offsets[list.renderedRange.end]).toBeGreaterThan(
			container.scrollTop + container.clientHeight,
		);

		mounted.mockClear();
		list.updateHeight(list.items[list.renderedRange.start], 120);
		list.onScroll();
		expect(mounted).toHaveBeenCalledOnce();
		mounted.mockClear();
		list.append(document.createElement("div"));
		list.onScroll();
		expect(mounted).toHaveBeenCalledOnce();
		list.destroy();
		container.remove();
	});

	it("retains all items while mounting only the viewport window", () => {
		const { container, list } = createList();
		const elements = Array.from({ length: 1000 }, (_, index) => {
			const element = document.createElement("div");
			element.textContent = `message-${index}`;
			list.append(element);
			return element;
		});

		list.render();

		expect(list.length).toBe(1000);
		expect(list.mountedCount).toBeLessThan(40);
		expect(elements[999].isConnected).toBe(true);
		expect(elements[0].isConnected).toBe(false);

		list.stickToBottom = false;
		container.scrollTop = 0;
		list.render();
		expect(elements[0].isConnected).toBe(true);
		expect(elements[999].isConnected).toBe(false);

		list.destroy();
		container.remove();
	});

	it("updates variable measurements and clears the retained model", () => {
		const { container, list } = createList();
		const element = document.createElement("div");
		list.append(element);
		list.render();

		list.updateHeight(list.items[0], 96);
		list.rebuildOffsets();
		expect(list.offsets).toEqual([0, 96]);

		list.clear();
		expect(list.length).toBe(0);
		expect(list.mountedCount).toBe(0);
		expect(container.scrollTop).toBe(0);

		list.destroy();
		container.remove();
	});

	it("preserves an inline footer outside the virtualized rows", () => {
		const container = document.createElement("div");
		Object.defineProperty(container, "clientHeight", {
			configurable: true,
			value: 200,
		});
		document.body.append(container);
		const footer = document.createElement("form");
		footer.textContent = "REPL prompt";
		const list = new VariableVirtualList(container, { footer });

		list.append(document.createElement("div"));
		list.render();
		expect(container.lastElementChild).toBe(footer);

		list.clear();
		expect(container.lastElementChild).toBe(footer);
		expect(footer.isConnected).toBe(true);

		list.destroy();
		container.remove();
	});

	it("includes the footer height when pinning and rendering the bottom", () => {
		const container = document.createElement("div");
		Object.defineProperties(container, {
			clientHeight: { configurable: true, value: 200 },
			scrollHeight: { configurable: true, value: 5304 },
		});
		document.body.append(container);
		const footer = document.createElement("form");
		footer.getBoundingClientRect = () => ({ height: 104 });
		const list = new VariableVirtualList(container, {
			footer,
			overscan: 0,
		});
		for (let index = 0; index < 100; index++) {
			list.append(document.createElement("div"));
		}

		list.render();

		expect(list.renderedRange.start).toBe(98);
		expect(list.renderedRange.end).toBe(100);
		expect(container.scrollTop).toBe(5104);
		expect(container.lastElementChild).toBe(footer);

		list.destroy();
		container.remove();
	});

	it("keeps a pinned footer visible when the viewport height changes", () => {
		let viewportHeight = 200;
		const container = document.createElement("div");
		Object.defineProperties(container, {
			clientHeight: {
				configurable: true,
				get: () => viewportHeight,
			},
			scrollHeight: { configurable: true, value: 5304 },
		});
		document.body.append(container);
		const footer = document.createElement("form");
		footer.getBoundingClientRect = () => ({ height: 104 });
		const list = new VariableVirtualList(container, { footer });
		for (let index = 0; index < 100; index++) {
			list.append(document.createElement("div"));
		}
		list.render();
		expect(container.scrollTop).toBe(5104);

		viewportHeight = 100;
		list.onResize([
			{
				target: container,
				contentRect: { height: viewportHeight },
			},
		]);
		list.render();

		expect(list.stickToBottom).toBe(true);
		expect(container.scrollTop).toBe(5204);

		list.destroy();
		container.remove();
	});

	it("pre-paints a larger guard before touch momentum starts", () => {
		const { container, list } = createList();
		for (let index = 0; index < 1000; index++) {
			list.append(document.createElement("div"));
		}
		list.stickToBottom = false;
		container.scrollTop = 10000;
		list.render();
		const idleCount = list.mountedCount;

		container.dispatchEvent(new Event("touchstart"));

		expect(list.dynamicOverscan).toBe(list.activeOverscan);
		expect(list.mountedCount).toBeGreaterThan(idleCount);

		list.destroy();
		container.remove();
	});

	it("keeps overlapping rows mounted during incremental scrolling", () => {
		const { container, list } = createList();
		Object.defineProperty(container, "scrollHeight", {
			configurable: true,
			value: 10400,
		});
		const elements = Array.from({ length: 200 }, () => {
			const element = document.createElement("div");
			list.append(element);
			return element;
		});
		list.stickToBottom = false;
		container.scrollTop = 520;
		list.render();
		const retained = elements[10];
		expect(retained.isConnected).toBe(true);

		container.scrollTop = 624;
		container.dispatchEvent(new Event("scroll"));

		expect(retained.isConnected).toBe(true);
		expect(list.dynamicOverscan).toBeGreaterThan(list.overscan);

		list.destroy();
		container.remove();
	});
});
