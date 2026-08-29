// @vitest-environment happy-dom

import tag from "html-tag-js";
import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
	push: vi.fn(),
	remove: vi.fn(),
	restoreTheme: vi.fn(),
}));

vi.mock("components/checkbox", () => ({ default: () => null }));
vi.mock("dompurify", () => ({
	default: { sanitize: vi.fn((value) => value) },
}));
vi.mock("lib/actionStack", () => ({
	default: {
		push: mocks.push,
		remove: mocks.remove,
	},
}));
vi.mock("lib/restoreTheme", () => ({ default: mocks.restoreTheme }));

import confirm from "dialogs/confirm";

const originalApp = globalThis.app;
const originalStrings = globalThis.strings;
const originalTag = globalThis.tag;

function restoreGlobal(name, value) {
	if (value === undefined) {
		Reflect.deleteProperty(globalThis, name);
	} else {
		globalThis[name] = value;
	}
}

function getDialog() {
	return document.querySelector(".prompt.confirm");
}

function getButtons() {
	return document.querySelectorAll(".button-container button");
}

describe("confirm dialog layering", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.clearAllMocks();
		document.body.replaceChildren();
		globalThis.tag = tag;
		globalThis.app = document.body;
		globalThis.strings = { ok: "OK", cancel: "Cancel" };
	});

	afterEach(() => {
		vi.runOnlyPendingTimers();
		vi.useRealTimers();
		document.body.replaceChildren();
	});

	afterAll(() => {
		restoreGlobal("app", originalApp);
		restoreGlobal("strings", originalStrings);
		restoreGlobal("tag", originalTag);
	});

	it("keeps the default layer and resolves false when cancelled", async () => {
		const result = confirm("Delete", "Delete this review?");
		const dialog = getDialog();

		expect(dialog).not.toBeNull();
		expect(dialog.className).toBe("prompt confirm");

		getButtons()[0].click();

		await expect(result).resolves.toBe(false);
	});

	it("applies the overlay layer without losing RTL and resolves true", async () => {
		const result = confirm("Delete", "Delete this review?", false, {
			direction: "rtl",
			aboveOverlay: true,
		});
		const dialog = getDialog();

		expect(dialog).not.toBeNull();
		expect(dialog.className).toBe("prompt confirm above-overlay");
		expect(dialog.dir).toBe("rtl");

		getButtons()[1].click();

		await expect(result).resolves.toBe(true);
	});
});
