import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	config: { HAS_PRO: false },
	settings: { value: { appIcon: "default" }, update: vi.fn() },
	confirm: vi.fn(),
	reward: vi.fn(),
	purchase: vi.fn(),
	toast: vi.fn(),
	error: vi.fn(),
	pass: false,
}));
vi.mock("components/toast", () => ({ default: mocks.toast }));
vi.mock("dialogs/confirm", () => ({ default: mocks.confirm }));
vi.mock("lib/config", () => ({ default: mocks.config }));
vi.mock("lib/settings", () => ({ default: mocks.settings }));
vi.mock("lib/adRewards", () => ({
	default: { canShowAds: () => !mocks.config.HAS_PRO && !mocks.pass },
}));
vi.mock("lib/rewardedAd", () => ({ default: mocks.reward }));
vi.mock("lib/removeAds", () => ({ requestProPurchase: mocks.purchase }));
vi.mock("utils/helpers", () => ({
	default: {
		error: mocks.error,
		promisify: (fn, ...args) =>
			new Promise((resolve, reject) => fn(...args, resolve, reject)),
	},
}));
import createAppIconSelection from "lib/appIconSelection";

function harness() {
	const controller = new AbortController();
	const onBusy = vi.fn();
	const onChange = vi.fn();
	return {
		controller,
		onBusy,
		onChange,
		select: createAppIconSelection({
			signal: controller.signal,
			onBusy,
			onChange,
		}),
	};
}
beforeEach(() => {
	vi.clearAllMocks();
	mocks.config.HAS_PRO = false;
	mocks.pass = false;
	mocks.settings.value.appIcon = "default";
	mocks.settings.update.mockImplementation(async ({ appIcon }) => {
		mocks.settings.value.appIcon = appIcon;
	});
	mocks.confirm.mockResolvedValue(true);
	mocks.reward.mockResolvedValue(true);
	mocks.purchase.mockResolvedValue(false);
	vi.stubGlobal("strings", {
		"app icon": "App icon",
		"confirm app icon reward": "Watch?",
		"app icon changed": "Changed",
		"rewarded ad incomplete": "Incomplete",
	});
	vi.stubGlobal("system", { setAppIcon: vi.fn((id, success) => success()) });
});

describe("icon selection", () => {
	it("opens Pro purchase without watching an ad or applying the locked icon", async () => {
		mocks.pass = true;
		const h = harness();
		mocks.purchase.mockImplementation(async () => {
			mocks.config.HAS_PRO = true;
		});
		await h.select("pro");
		expect(mocks.purchase).toHaveBeenCalledOnce();
		expect(mocks.reward).not.toHaveBeenCalled();
		expect(system.setAppIcon).not.toHaveBeenCalled();
		await h.select("pro");
		expect(system.setAppIcon).toHaveBeenCalledWith(
			"pro",
			expect.any(Function),
			expect.any(Function),
		);
	});
	it.each([
		"default",
		"paid",
		"pass",
	])("skips rewarded ads for %s", async (kind) => {
		mocks.settings.value.appIcon = "pixel_party";
		mocks.config.HAS_PRO = kind === "paid";
		mocks.pass = kind === "pass";
		await harness().select(kind === "default" ? "default" : "midnight_circuit");
		expect(mocks.confirm).not.toHaveBeenCalled();
		expect(mocks.reward).not.toHaveBeenCalled();
		expect(mocks.settings.update).toHaveBeenCalledOnce();
		expect(mocks.toast).toHaveBeenCalledWith("Changed");
	});
	it("ignores current/unknown icons and serializes confirmation and reward", async () => {
		const h = harness();
		await h.select("default");
		await h.select("unknown");
		expect(h.onBusy).not.toHaveBeenCalled();
		let confirm;
		mocks.confirm.mockImplementation(
			() =>
				new Promise((resolve) => {
					confirm = resolve;
				}),
		);
		const first = h.select("pixel_party");
		await h.select("solar_flare");
		expect(mocks.confirm).toHaveBeenCalledOnce();
		expect(mocks.reward).not.toHaveBeenCalled();
		confirm(true);
		await first;
		expect(system.setAppIcon.mock.calls[0][0]).toBe("pixel_party");
		expect(h.onBusy.mock.calls).toEqual([[true], [false]]);
		expect(mocks.toast).toHaveBeenCalledTimes(1);
	});
	it.each([
		"decline",
		"incomplete",
		"load failure",
		"native failure",
	])("keeps the current selection on %s", async (kind) => {
		if (kind === "decline") mocks.confirm.mockResolvedValue(false);
		if (kind === "incomplete") mocks.reward.mockResolvedValue(false);
		if (kind === "load failure")
			mocks.reward.mockRejectedValue(new Error("Unavailable"));
		if (kind === "native failure")
			system.setAppIcon.mockImplementation((id, ok, fail) =>
				fail("Native failure"),
			);
		const h = harness();
		await h.select("pixel_party");
		expect(mocks.settings.value.appIcon).toBe("default");
		expect(mocks.settings.update).not.toHaveBeenCalled();
		expect(mocks.toast).not.toHaveBeenCalledWith("Changed");
		expect(h.onBusy).toHaveBeenLastCalledWith(false);
		if (kind === "decline") expect(mocks.reward).not.toHaveBeenCalled();
	});
	it("ignores a reward received after leaving the picker", async () => {
		let finish;
		mocks.reward.mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		const h = harness();
		const pending = h.select("pixel_party");
		await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
		h.controller.abort();
		finish(true);
		await pending;
		expect(system.setAppIcon).not.toHaveBeenCalled();
		expect(h.onChange).not.toHaveBeenCalled();
		expect(mocks.toast).not.toHaveBeenCalled();
	});
	it("does not apply after leaving during confirmation", async () => {
		const h = harness();
		mocks.confirm.mockImplementation(async () => {
			h.controller.abort();
			return true;
		});
		await h.select("pixel_party");
		expect(mocks.reward).not.toHaveBeenCalled();
		expect(system.setAppIcon).not.toHaveBeenCalled();
	});
});
