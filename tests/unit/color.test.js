import { describe, expect, it } from "vitest";
import Hex from "utils/color/hex";
import Hsl from "utils/color/hsl";
import { isValidColor } from "utils/color/regex";
import Rgb from "utils/color/rgb";

describe("Rgb", () => {
	it("stringifies opaque colors as rgb()", () => {
		expect(new Rgb(255, 0, 0).toString()).toBe("rgb(255, 0, 0)");
	});

	it("stringifies translucent colors as rgba()", () => {
		expect(new Rgb(255, 0, 0, 0.5).toString()).toBe("rgba(255, 0, 0, 0.5)");
	});

	it("can force the alpha channel on or off", () => {
		expect(new Rgb(255, 0, 0).toString(true)).toBe("rgba(255, 0, 0, 1)");
		expect(new Rgb(255, 0, 0, 0.5).toString(false)).toBe("rgb(255, 0, 0)");
	});
});

describe("Hex", () => {
	it("stringifies colors as uppercase hex", () => {
		expect(new Hex(255, 0, 0, 255).toString()).toBe("#FF0000");
		expect(new Hex(0, 128, 255, 255).toString()).toBe("#0080FF");
	});

	it("includes the alpha channel when it is not opaque", () => {
		expect(new Hex(255, 0, 0, 128).toString()).toBe("#FF000080");
	});

	it("can force the alpha channel on or off", () => {
		expect(new Hex(255, 0, 0, 128).toString(false)).toBe("#FF0000");
		expect(new Hex(255, 0, 0, 255).toString(true)).toBe("#FF0000FF");
	});

	it("pads single-digit channels", () => {
		expect(new Hex(1, 2, 3, 255).toString()).toBe("#010203");
	});

	it("converts to an Rgb instance", () => {
		const rgb = new Hex(10, 20, 30, 40).rgb;
		expect(rgb).toBeInstanceOf(Rgb);
		expect([rgb.r, rgb.g, rgb.b, rgb.a]).toEqual([10, 20, 30, 40]);
	});
});

describe("Hsl", () => {
	it("exposes degree/percentage getters", () => {
		const hsl = new Hsl(0.5, 0.25, 1, 0.5);
		expect(hsl.hue).toBe(180);
		expect(hsl.saturation).toBe(25);
		expect(hsl.lightness).toBe(100);
		expect(hsl.toString()).toBe("hsla(180, 25%, 100%, 0.5)");
	});

	it("converts pure red from rgb", () => {
		const hsl = Hsl.fromRgb(new Rgb(255, 0, 0));
		expect(hsl.h).toBe(0);
		expect(hsl.s).toBe(1);
		expect(hsl.l).toBe(0.5);
		expect(hsl.toString()).toBe("hsl(0, 100%, 50%)");
	});

	it("round-trips primary colors through rgb", () => {
		for (const [r, g, b] of [
			[255, 0, 0],
			[0, 255, 0],
			[0, 0, 255],
			[255, 255, 255],
			[0, 0, 0],
		]) {
			const rgb = Hsl.fromRgb(new Rgb(r, g, b)).rgb;
			expect([rgb.r, rgb.g, rgb.b]).toEqual([r, g, b]);
		}
	});
});

describe("isValidColor", () => {
	it("accepts hex colors", () => {
		expect(isValidColor("#ff0000")).toBe(true);
		expect(isValidColor("#FFF")).toBe(true);
		expect(isValidColor("#FF000080")).toBe(true);
	});

	it("accepts functional notations", () => {
		expect(isValidColor("rgb(255, 0, 0)")).toBe(true);
		expect(isValidColor("rgba(255, 0, 0, 0.5)")).toBe(true);
		expect(isValidColor("hsl(120, 50%, 50%)")).toBe(true);
	});

	it("accepts named colors", () => {
		expect(isValidColor("red")).toBe(true);
		expect(isValidColor("rebeccapurple")).toBe(true);
	});

	it("rejects invalid values", () => {
		expect(isValidColor("not-a-color")).toBe(false);
		expect(isValidColor("")).toBe(false);
		expect(isValidColor("rgb(300, 0, 0)")).toBe(false);
		expect(isValidColor("#gg0000")).toBe(false);
	});
});
