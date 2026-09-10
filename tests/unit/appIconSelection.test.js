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
	external: false,
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
		shouldAllowExternalPurchase: () => mocks.external,
		promisify: (fn, ...args) =>
			new Promise((resolve, reject) => fn(...args, resolve, reject)),
	},
}));
import selectAppIcon from "lib/appIconSelection";

function harness() {
	const controller = new AbortController();
	const onBusy = vi.fn();
	const onLoading = vi.fn();
	const onChange = vi.fn();
	return {
		controller,
		onBusy,
		onLoading,
		onChange,
		select(iconId) {
			return selectAppIcon(iconId, {
				signal: controller.signal,
				onBusy,
				onLoading,
				onChange,
			});
		},
	};
}
beforeEach(() => {
	vi.clearAllMocks();
	mocks.config.HAS_PRO = false;
	mocks.pass = false;
	mocks.external = false;
	mocks.settings.value.appIcon = "default";
	mocks.settings.update.mockImplementation(async ({ appIcon }) => {
		mocks.settings.value.appIcon = appIcon;
	});
	mocks.confirm.mockResolvedValue(true);
	mocks.reward.mockResolvedValue(true);
	mocks.purchase.mockResolvedValue(false);
	vi.stubGlobal("strings", {
		"app icon": "App icon",
		"app icon change warning":
			"The app will exit after the app icon is changed.",
		"confirm app icon reward": "Watch?",
		"app icon changed": "Changed",
		"rewarded ad incomplete": "Incomplete",
	});
	vi.stubGlobal("system", { setAppIcon: vi.fn((id, success) => success()) });
});

describe("icon selection", () => {
	it.each([
		false,
		true,
	])("opens Pro purchase with external checkout %s", async (external) => {
		mocks.external = external;
		mocks.pass = true;
		const h = harness();
		mocks.purchase.mockImplementation(async () => {
			expect(h.onLoading.mock.calls).toEqual(external ? [] : [[true]]);
			mocks.config.HAS_PRO = true;
		});
		await h.select("pro");
		expect(mocks.purchase).toHaveBeenCalledOnce();
		expect(mocks.reward).not.toHaveBeenCalled();
		expect(system.setAppIcon).not.toHaveBeenCalled();
		expect(h.onLoading.mock.calls).toEqual(
			external ? [[false]] : [[true], [false]],
		);
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
		const h = harness();
		const pending = h.select(
			kind === "default"
				? "default"
				: kind === "paid"
					? "pro"
					: "midnight_circuit",
		);
		// The exit warning is confirmed before any loader is shown.
		expect(h.onLoading).not.toHaveBeenCalled();
		await pending;
		expect(h.onLoading.mock.calls).toEqual([[true], [false]]);
		// The app-exit warning is still shown before the icon is applied.
		expect(mocks.confirm).toHaveBeenCalledOnce();
		expect(mocks.reward).not.toHaveBeenCalled();
		expect(mocks.settings.update).toHaveBeenCalledOnce();
		expect(mocks.toast).toHaveBeenCalledWith("Changed");
	});
	it("warns that the app will exit before applying an icon", async () => {
		const h = harness();
		await h.select("pixel_party");
		expect(mocks.confirm.mock.calls[0][0]).toBe("App icon");
		expect(mocks.confirm.mock.calls[0][1]).toBe(
			"The app will exit after the app icon is changed.",
		);
		expect(system.setAppIcon).toHaveBeenCalledOnce();
	});
	it("ignores current/unknown icons and serializes confirmation and reward", async () => {
		const h = harness();
		await h.select("default");
		await h.select("unknown");
		expect(h.onBusy).not.toHaveBeenCalled();
		expect(h.onLoading).not.toHaveBeenCalled();
		const confirms = [];
		mocks.confirm.mockImplementation(
			() =>
				new Promise((resolve) => {
					confirms.push(resolve);
				}),
		);
		const first = h.select("pixel_party");
		await h.select("solar_flare");
		expect(mocks.confirm).toHaveBeenCalledOnce();
		expect(mocks.reward).not.toHaveBeenCalled();
		expect(h.onBusy).toHaveBeenCalledExactlyOnceWith(true);
		expect(h.onLoading).not.toHaveBeenCalled();
		mocks.reward.mockImplementation(async () => {
			expect(h.onLoading).toHaveBeenCalledExactlyOnceWith(true);
			await h.select("solar_flare");
			return true;
		});
		// The exit warning is confirmed first, then the rewarded-ad prompt.
		confirms[0](true);
		await vi.waitFor(() => expect(confirms).toHaveLength(2));
		confirms[1](true);
		await first;
		expect(mocks.confirm).toHaveBeenCalledTimes(2);
		expect(system.setAppIcon.mock.calls[0][0]).toBe("pixel_party");
		expect(h.onBusy.mock.calls).toEqual([[true], [false]]);
		expect(h.onLoading.mock.calls).toEqual([[true], [false]]);
		expect(mocks.reward).toHaveBeenCalledOnce();
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
		expect(h.onLoading.mock.calls).toEqual(
			kind === "decline" ? [[false]] : [[true], [false]],
		);
		if (kind === "decline") expect(mocks.reward).not.toHaveBeenCalled();
		if (kind === "load failure" || kind === "native failure") {
			expect(mocks.error).toHaveBeenCalledOnce();
		} else {
			expect(mocks.error).not.toHaveBeenCalled();
		}
		if (kind === "incomplete")
			expect(mocks.toast).toHaveBeenCalledWith("Incomplete");
	});
	it("shows success only after the native change has been persisted", async () => {
		mocks.pass = true;
		let applied, persisted;
		system.setAppIcon.mockImplementation((id, success) => {
			applied = success;
		});
		mocks.settings.update.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					persisted = resolve;
				}),
		);
		const h = harness();
		const pending = h.select("pixel_party");
		await vi.waitFor(() => expect(applied).toBeTypeOf("function"));
		expect(mocks.toast).not.toHaveBeenCalled();
		applied();
		await vi.waitFor(() => expect(persisted).toBeTypeOf("function"));
		expect(h.onChange).not.toHaveBeenCalled();
		expect(mocks.toast).not.toHaveBeenCalled();
		persisted();
		await pending;
		expect(h.onChange).toHaveBeenCalledOnce();
		expect(mocks.toast).toHaveBeenCalledExactlyOnceWith("Changed");
	});
	it.each([
		"pro",
		"pass",
	])("rechecks %s access after confirmation before loading", async (kind) => {
		const h = harness();
		mocks.confirm.mockImplementation(async () => {
			expect(h.onLoading).not.toHaveBeenCalled();
			mocks.config.HAS_PRO = kind === "pro";
			mocks.pass = kind === "pass";
			return true;
		});
		await h.select("pixel_party");
		expect(mocks.reward).not.toHaveBeenCalled();
		expect(system.setAppIcon).toHaveBeenCalledOnce();
		expect(h.onLoading.mock.calls).toEqual([[true], [false]]);
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
		expect(h.onLoading).toHaveBeenCalledExactlyOnceWith(true);
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
		expect(h.onLoading).not.toHaveBeenCalled();
	});
	it("keeps a reopened picker locked until an earlier native change is persisted", async () => {
		mocks.config.HAS_PRO = true;
		let applied;
		system.setAppIcon.mockImplementationOnce((id, success) => {
			applied = success;
		});
		const previous = harness();
		const pending = previous.select("pixel_party");
		await vi.waitFor(() => expect(applied).toBeTypeOf("function"));
		previous.controller.abort();
		const reopened = harness();
		await reopened.select("solar_flare");
		expect(system.setAppIcon).toHaveBeenCalledOnce();
		expect(reopened.onBusy).not.toHaveBeenCalled();
		applied();
		await pending;
		expect(mocks.settings.value.appIcon).toBe("pixel_party");
		expect(previous.onChange).not.toHaveBeenCalled();
		expect(previous.onLoading).toHaveBeenCalledExactlyOnceWith(true);
		expect(mocks.toast).not.toHaveBeenCalled();
		await reopened.select("solar_flare");
		expect(mocks.settings.value.appIcon).toBe("solar_flare");
		expect(reopened.onChange).toHaveBeenCalledOnce();
	});
});
