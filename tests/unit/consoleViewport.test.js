// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import {
	applyConsoleViewport,
	getConsoleViewportRect,
} from "lib/consoleRuntime";

describe("console visual viewport", () => {
	it("uses the visual viewport when the mobile keyboard shrinks the screen", () => {
		const windowObject = {
			innerHeight: 800,
			innerWidth: 400,
			visualViewport: {
				height: 476.4,
				width: 400,
				offsetTop: 12.2,
				offsetLeft: 0,
			},
		};

		expect(getConsoleViewportRect(windowObject)).toEqual({
			height: 476,
			width: 400,
			top: 12,
			left: 0,
		});

		const element = document.createElement("div");
		applyConsoleViewport(element, windowObject);
		expect(element.style.getPropertyValue("--console-viewport-height")).toBe(
			"476px",
		);
	});

	it("falls back to the layout viewport", () => {
		expect(
			getConsoleViewportRect({ innerHeight: 720, innerWidth: 360 }),
		).toEqual({ height: 720, width: 360, top: 0, left: 0 });
	});
});
