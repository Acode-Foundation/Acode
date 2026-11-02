// @vitest-environment happy-dom

import tag from "html-tag-js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import strings from "../../src/lang/en-us.json";
import { loadSourceModule } from "../helpers/loadSourceModule";

/** Minimal stand-in for the Back-button stack the dialog registers with. */
const stack = [];
const actionStack = {
	get length() {
		return stack.length;
	},
	push(entry) {
		stack.push(entry);
	},
	remove(id) {
		const index = stack.findIndex((entry) => entry.id === id);
		if (index !== -1) stack.splice(index, 1);
	},
	async pop() {
		stack.pop()?.action();
	},
};

const restoreTheme = vi.fn();

// The dialog uses the app's JSX transform, so it is compiled from source with
// its environment injected instead of imported directly.
function loadDialog() {
	// Values are passed unwrapped: the compiled module reads `.default`, and
	// Babel's interop supplies it for anything without `__esModule`.
	return loadSourceModule(
		"src/dialogs/noticePrompt.js",
		{
			"./style.scss": {},
			"components/page": (title, options) => {
				const $page = document.createElement("div");
				$page.className = "page notice-prompt";
				$page.dataset.title = title;
				$page.dataset.hasLead = String(Boolean(options?.lead));
				// WcPage.hide() removes the element itself.
				$page.hide = () => $page.remove();
				Object.defineProperty($page, "body", {
					set($body) {
						$page.replaceChildren($body);
					},
				});
				return $page;
			},
			"lib/actionStack": actionStack,
			"lib/restoreTheme": restoreTheme,
		},
		{ strings, tag, document, setTimeout, app: document.body },
	).default;
}

let noticePrompt;

beforeEach(() => {
	vi.useFakeTimers();
	stack.length = 0;
	vi.clearAllMocks();
	document.body.replaceChildren();
	vi.stubGlobal("app", document.body);
	vi.stubGlobal("tag", tag);
	vi.stubGlobal("strings", strings);
	noticePrompt = loadDialog();
});

afterEach(() => {
	vi.runAllTimers();
	vi.restoreAllMocks();
	vi.useRealTimers();
	vi.unstubAllGlobals();
	document.body.replaceChildren();
});

const content = () => document.querySelector(".page");

it("shows its own buttons instead of relying on a platform dialog", () => {
	noticePrompt("Host key", "Verify this host", {
		buttons: [
			{ text: "Cancel", value: false },
			{ text: "Trust", value: true, primary: true },
		],
	});

	const buttons = [...content().querySelectorAll(".notice-actions button")];
	expect(buttons.map(($b) => $b.textContent)).toEqual(["Cancel", "Trust"]);
	expect(buttons[1].classList.contains("primary")).toBe(true);
});

it("renders labelled values so a fingerprint can be compared by eye", () => {
	noticePrompt(
		"Host key",
		"This is the first connection.\n\nKey type: rsa-sha2-256\nFingerprint: SHA256:abc123",
		{ buttons: [{ text: "Trust", value: true }] },
	);

	expect(content().querySelector(".notice-text").textContent).toBe(
		"This is the first connection.",
	);

	const rows = [...content().querySelectorAll(".notice-row")];
	expect(rows).toHaveLength(2);
	expect(rows[0].querySelector(".notice-label").textContent).toBe("Key type");
	expect(rows[0].querySelector(".notice-value").textContent).toBe(
		"rsa-sha2-256",
	);
	expect(rows[1].querySelector(".notice-value").textContent).toBe(
		"SHA256:abc123",
	);
});

it("resolves with the chosen value and cleans up", async () => {
	const result = noticePrompt("Host key", "Verify", {
		buttons: [
			{ text: "Cancel", value: false },
			{ text: "Trust", value: true, primary: true },
		],
	});

	content().querySelectorAll(".notice-actions button")[1].click();
	await expect(result).resolves.toBe(true);
	vi.runAllTimers();

	expect(document.querySelector(".page")).toBeNull();
	expect(actionStack.length).toBe(0);
	expect(restoreTheme).toHaveBeenLastCalledWith();
});

it("resolves undefined when dismissed with Back", async () => {
	const oncancel = vi.fn();
	const result = noticePrompt("Host key", "Verify", {
		oncancel,
		buttons: [{ text: "Trust", value: true }],
	});

	await actionStack.pop();
	await expect(result).resolves.toBeUndefined();
	expect(oncancel).toHaveBeenCalledOnce();
	vi.runAllTimers();
	expect(actionStack.length).toBe(0);
});

it("ignores a second answer after the prompt closed", async () => {
	const result = noticePrompt("Host key", "Verify", {
		buttons: [{ text: "Trust", value: true }],
	});

	const button = content().querySelector(".notice-actions button");
	button.click();
	button.click();
	await expect(result).resolves.toBe(true);
	vi.runAllTimers();
	expect(actionStack.length).toBe(0);
});
