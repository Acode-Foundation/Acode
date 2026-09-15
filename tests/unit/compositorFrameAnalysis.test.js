import jpeg from "jpeg-js";
import { describe, expect, it } from "vitest";
import {
	analyzeCompositorFrame,
	parseCompositorColor,
} from "../../utils/benchmarks/compositorFrameAnalysis.mjs";

const setup = {
	viewportWidth: 40,
	viewportHeight: 40,
	contentRect: { left: 0, top: 0, width: 40, height: 40 },
	backgrounds: ["rgba(0, 0, 0, 0)", "rgb(20, 20, 20)"],
};

function frameWithText(hasText) {
	const width = 40;
	const height = 40;
	const data = Buffer.alloc(width * height * 4);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const offset = (y * width + x) * 4;
			const text = hasText && x >= 4 && x < 22 && y >= 8 && y < 16;
			data[offset] = data[offset + 1] = data[offset + 2] = text ? 230 : 20;
			data[offset + 3] = 255;
		}
	}
	return {
		data: jpeg.encode({ data, width, height }, 100).data.toString("base64"),
	};
}

describe("compositor frame analysis", () => {
	it("ignores transparent candidates and parses the painted background", () => {
		expect(parseCompositorColor("rgba(1, 2, 3, 0)")).toBeNull();
		expect(parseCompositorColor("rgb(20, 21, 22)")).toEqual([20, 21, 22]);
	});

	it("distinguishes background-only frames from rendered text", () => {
		expect(analyzeCompositorFrame(frameWithText(false), setup).blank).toBe(true);
		expect(analyzeCompositorFrame(frameWithText(true), setup).blank).toBe(false);
	});
});
