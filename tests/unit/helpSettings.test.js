// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import strings from "../../src/lang/en-us.json";
import { loadSourceModule } from "../helpers/loadSourceModule";

afterEach(() => {
	document.body.replaceChildren();
	vi.restoreAllMocks();
});

it("opens FAQs once for concurrent taps and allows a later visit", async () => {
	const { select, open } = setup();
	await Promise.all([select("faqs"), select("faqs")]);
	expect(open).toHaveBeenCalledTimes(1);
	await select("faqs");
	expect(open).toHaveBeenCalledTimes(2);
});

it("reports a failed page download and allows another attempt", async () => {
	vi.spyOn(console, "error").mockImplementation(() => {});
	const { select, load, open, toast } = setup();
	load.mockImplementationOnce(() => {
		throw new Error("Chunk unavailable");
	});
	await expect(select("faqs")).resolves.toBeUndefined();
	expect(toast).toHaveBeenCalledWith(strings["faqs load failed"]);
	expect(open).not.toHaveBeenCalled();
	await select("faqs");
	expect(open).toHaveBeenCalledTimes(1);
});

it.each([
	["closed", "success"],
	["disconnected", "success"],
	["disconnected", "failure"],
])("ignores a %s Help page after import %s", async (state, outcome) => {
	const { select, page, open, toast, load } = setup();
	if (outcome === "failure") {
		load.mockImplementationOnce(() => {
			throw new Error("Chunk unavailable");
		});
	}
	const pending = select("faqs");
	if (state === "closed") page.onClose.mock.calls[0][0]();
	else page.getListElement().remove();
	await pending;
	expect(open).not.toHaveBeenCalled();
	expect(toast).not.toHaveBeenCalled();
});

function setup() {
	const open = vi.fn();
	const load = vi.fn(() => open);
	const toast = vi.fn();
	const list = document.createElement("div");
	const page = {
		show: () => document.body.append(list),
		onClose: vi.fn(),
		getListElement: () => list,
	};
	const settingsPage = vi.fn(() => page);
	const help = loadSourceModule(
		"src/settings/helpSettings.js",
		{
			"components/settingsPage": settingsPage,
			"components/toast": toast,
			"lang/en-us.json": strings,
			"lib/config": {},
			get "pages/faqs/faqs"() {
				return load();
			},
		},
		{ strings: { ...strings, "faqs load failed": undefined } },
	).default;
	help();
	return { select: settingsPage.mock.calls[0][2], load, open, toast, page };
}
