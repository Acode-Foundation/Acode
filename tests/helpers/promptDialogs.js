import { createRequire } from "node:module";
import tag from "html-tag-js";
import { vi } from "vitest";
import { loadSourceModule } from "./loadSourceModule";
import setupSponsorPurchases from "./sponsorPurchases";

createRequire(import.meta.url)("html-tag-js/polyfill");

export default function setup() {
	// happy-dom does not bind `this` for VM-created focus handlers.
	vi.spyOn(HTMLInputElement.prototype, "focus").mockImplementation(() => {});
	const f = setupSponsorPurchases("com.foxdebug.acodefree");
	localStorage.clear();
	const settings = { value: { keyboardMode: "CODE" } };
	const actionStack = loadSourceModule("src/lib/actionStack.js", {
		"dialogs/confirm": vi.fn(),
		"lib/platform": { appExit: false },
		"lib/settings": settings,
	}).default;
	const system = { setInputType: vi.fn() };
	const globals = {
		tag,
		document,
		localStorage,
		system,
		AbortController,
		strings: { ok: "OK", cancel: "Cancel", info: "Info", required: "Required" },
	};
	const restorePromptInput = loadSourceModule(
		"src/dialogs/restorePromptInput.js",
		{
			"lib/settings": settings,
		},
		globals,
	).default;
	const prompt = loadSourceModule(
		"src/dialogs/multiPrompt.js",
		{
			autosize: vi.fn(),
			"components/checkbox": (text, checked, name, id, type) =>
				tag("input", { checked, name, id, type }),
			"components/inputhints": vi.fn(),
			"lib/actionStack": actionStack,
			"lib/restoreTheme": vi.fn(),
			"./restorePromptInput": restorePromptInput,
			"./alert": vi.fn(),
		},
		globals,
	).default;
	const singlePrompt = loadSourceModule(
		"src/dialogs/prompt.js",
		{
			autosize: vi.fn(),
			"lib/actionStack": actionStack,
			"lib/platform": { isIOS: false },
			"lib/restoreTheme": vi.fn(),
			"./restorePromptInput": restorePromptInput,
		},
		{ ...globals, app: document.body, editorManager: { editor: {} } },
	).default;
	const details = loadSourceModule(
		"src/pages/sponsor/details.js",
		{
			"dialogs/multiPrompt": prompt,
			"lib/platform": { isIOS: false },
			"utils/helpers": { error: f.error },
		},
		globals,
	).default;
	f.recoverDetails.mockImplementation(details);
	Object.assign(f.iap, {
		startConnection: vi.fn((success) => success(0)),
		getPurchases: vi.fn((success) =>
			success([
				{
					productIds: ["crystal"],
					purchaseState: 1,
					purchaseToken: "paid-token",
				},
			]),
		),
		addPurchaseUpdatedListener: vi.fn(),
		purchase: vi.fn(),
	});
	const recovery = loadSourceModule(
		"src/pages/sponsor/recovery.js",
		{
			"dialogs/dialog": vi.fn(),
			"utils/helpers": { error: f.error },
			"./pending": f.pending,
			"./purchases": f.createProcessor,
		},
		{ ...globals, iap: f.iap },
	);
	return { ...f, actionStack, system, prompt, singlePrompt, service: recovery };
}
