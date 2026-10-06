import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	show: vi.fn(),
	getStatus: vi.fn(),
	redeem: vi.fn(),
	suppress: vi.fn(),
}));
vi.mock("components/toast", () => ({ default: vi.fn() }));
vi.mock("lib/config", () => ({ default: { HAS_PRO: false } }));
vi.mock("lib/rewardedAd", () => ({
	default: mocks.show,
	isRewardedAdSupported: () => true,
	isWatchingRewardedAd: () => false,
}));
vi.mock("lib/startAd", () => ({ setBannerSuppressed: mocks.suppress }));
vi.mock("lib/secureAdRewardState", () => ({
	default: { getStatus: mocks.getStatus, redeem: mocks.redeem },
}));
let adRewards;
beforeEach(async () => {
	vi.resetModules();
	vi.useFakeTimers();
	vi.clearAllMocks();
	vi.stubGlobal("window", {});
	vi.stubGlobal("user", { id: "test-user" });
	vi.stubGlobal("strings", { "rewarded ad incomplete": "Incomplete" });
	mocks.getStatus.mockResolvedValue({ canRedeem: true });
	mocks.show.mockResolvedValue(true);
	mocks.redeem.mockResolvedValue({
		canRedeem: true,
		isActive: true,
		adFreeUntil: Date.now() + 3_600_000,
		appliedDurationMs: 3_600_000,
	});
	({ default: adRewards } = await import("lib/adRewards"));
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

it("shares duplicate pass requests during status refresh and preserves step verification", async () => {
	let refreshed;
	mocks.getStatus.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				refreshed = resolve;
			}),
	);
	const first = adRewards.watchOffer("focus");
	const duplicate = adRewards.watchOffer("focus");
	refreshed({ canRedeem: true });
	await Promise.all([first, duplicate]);
	expect(mocks.show).toHaveBeenCalledTimes(2);
	const firstMetadata = mocks.show.mock.calls[0][0].serverSideVerification;
	const secondMetadata = mocks.show.mock.calls[1][0].serverSideVerification;
	expect(firstMetadata.userId).toBe("test-user");
	expect(firstMetadata.customData).toContain("&offer=focus&step=1&ads=2");
	expect(secondMetadata.customData).toBe(
		firstMetadata.customData.replace("step=1", "step=2"),
	);
	expect(mocks.redeem).toHaveBeenCalledExactlyOnceWith("focus");
	expect(adRewards.isAdFreeActive()).toBe(true);
});
it("never grants a pass for an incomplete reward and permits retry", async () => {
	mocks.show.mockResolvedValueOnce(false);
	await expect(adRewards.watchOffer("quick")).rejects.toThrow("Incomplete");
	expect(mocks.redeem).not.toHaveBeenCalled();
	expect(adRewards.isWatchingReward()).toBe(false);
	await adRewards.watchOffer("quick");
	expect(mocks.redeem).toHaveBeenCalledExactlyOnceWith("quick");
});
