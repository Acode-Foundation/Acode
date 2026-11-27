import { expect, test } from "vitest";
import formatDownloadProgress from "../../src/lib/downloadProgress.js";

test("falls back to the label when the total is unknown", () => {
	expect(formatDownloadProgress(50, 0, "Loading")).toBe("Loading");
	expect(formatDownloadProgress(50, undefined, "Loading")).toBe("Loading");
	expect(formatDownloadProgress(50, Number.NaN, "Loading")).toBe("Loading");
	expect(formatDownloadProgress(50, Number.POSITIVE_INFINITY, "Loading")).toBe(
		"Loading",
	);
});

test("formats the percentage when the total is known", () => {
	expect(formatDownloadProgress(50, 100, "Loading")).toBe("Loading 50.00%");
	expect(formatDownloadProgress(1, 3, "Loading")).toBe("Loading 33.33%");
});

test("clamps the percentage to 100", () => {
	expect(formatDownloadProgress(150, 100, "Loading")).toBe("Loading 100.00%");
});

test("uses the global loading label by default", () => {
	globalThis.strings = { loading: "Chargement" };
	expect(formatDownloadProgress(1, 2)).toBe("Chargement 50.00%");
	delete globalThis.strings;
});
