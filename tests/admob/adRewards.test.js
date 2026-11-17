import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getStatus: vi.fn(),
	suppress: vi.fn(),
	toast: vi.fn(),
}));
vi.mock("components/toast", () => ({ default: mocks.toast }));
vi.mock("lib/config", () => ({ default: { HAS_PRO: false } }));
vi.mock("lib/startAd", () => ({ setBannerSuppressed: mocks.suppress }));
vi.mock("lib/secureAdRewardState", () => ({
	default: { getStatus: mocks.getStatus },
}));

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

it("honors existing earned time, then resumes ads and announces expiry", async () => {
	vi.resetModules();
	vi.useFakeTimers();
	vi.stubGlobal("window", {});
	mocks.getStatus
		.mockResolvedValueOnce({
			isActive: true,
			adFreeUntil: Date.now() + 3_600_000,
		})
		.mockResolvedValue({ isActive: false, hasPendingExpiryNotice: true });
	const { default: adRewards } = await import("lib/adRewards");
	await adRewards.init();
	expect(adRewards.isAdFreeActive()).toBe(true);
	expect(adRewards.canShowAds()).toBe(false);
	expect(mocks.suppress).toHaveBeenLastCalledWith("rewarded-pass", true);
	expect(mocks.toast).not.toHaveBeenCalled();

	await vi.advanceTimersByTimeAsync(3_600_000);
	expect(adRewards.isAdFreeActive()).toBe(false);
	expect(adRewards.canShowAds()).toBe(true);
	expect(mocks.suppress).toHaveBeenLastCalledWith("rewarded-pass", false);
	expect(mocks.toast).toHaveBeenCalledExactlyOnceWith(
		"Your rewarded ad-free time has expired. Ads will now resume.",
		4000,
	);
});
