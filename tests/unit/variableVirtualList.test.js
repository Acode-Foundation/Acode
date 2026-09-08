// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
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
