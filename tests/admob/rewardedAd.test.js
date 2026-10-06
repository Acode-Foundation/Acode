import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RewardedAd } from "../../src/plugins/admob/src/www/ads/rewarded";
const mocks = vi.hoisted(() => ({
	start: vi.fn(),
	config: { HAS_PRO: false },
	ready: true,
	allowed: true,
}));
vi.mock("lib/config", () => ({ default: mocks.config }));
vi.mock("lib/startAd", () => ({
	default: mocks.start,
	adUnitIdRewarded: "test-unit",
	get initialized() {
		return mocks.ready;
	},
	getPrivacyState: () => ({ canRequestAds: mocks.allowed }),
}));
let showRewardedAd;
let instances;
const flush = async () => {
	for (let i = 0; i < 8; i++) await Promise.resolve();
};
class Ad {
	constructor(options) {
		this.options = options;
		this.id = options.id;
		this.listeners = new Map();
		instances.push(this);
	}
	on(name, listener) {
		this.listeners.set(name, listener);
		return () => this.listeners.delete(name);
	}
	emit(name) {
		this.listeners.get(name)?.();
	}
	load = vi.fn().mockResolvedValue();
	show = vi.fn().mockResolvedValue();
	destroy = vi.fn().mockResolvedValue();
}
beforeEach(async () => {
	vi.resetModules();
	vi.useFakeTimers();
	instances = [];
	mocks.config.HAS_PRO = false;
	mocks.ready = true;
	mocks.allowed = true;
	mocks.start.mockReset().mockResolvedValue();
	vi.stubGlobal("window", { ANDROID_SDK_INT: 36 });
	vi.stubGlobal("admob", { RewardedAd: Ad });
	vi.stubGlobal("strings", {
		"rewarded ad unavailable": "Unavailable",
		"rewarded ad failed": "Failed",
	});
	({ default: showRewardedAd } = await import("lib/rewardedAd"));
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("shared rewarded ad lifecycle", () => {
	it("waits for reward AND dismissal, retaining verification metadata and cleaning listeners", async () => {
		const verification = { userId: "guest", customData: "offer=quick&step=1" };
		const done = vi.fn();
		const result = showRewardedAd({ serverSideVerification: verification });
		result.then(done);
		await flush();
		const ad = instances[0];
		expect(ad.options.serverSideVerification).toEqual(verification);
		expect(ad.options.adUnitId).toBe("test-unit");
		ad.emit("reward");
		await flush();
		expect(done).not.toHaveBeenCalled();
		ad.emit("dismiss");
		await expect(result).resolves.toBe(true);
		expect(ad.listeners.size).toBe(0);
		expect(ad.destroy).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(0);
	});
	it.each([
		"dismiss",
		"loadfail",
		"showfail",
		"load rejection",
		"show rejection",
		"show false",
	])("settles and cleans up on %s", async (event) => {
		if (event === "loadfail")
			vi.spyOn(Ad.prototype, "on").mockImplementationOnce(
				function (name, callback) {
					this.load.mockImplementation(async () => {
						this.emit("loadfail");
						throw new Error("network");
					});
					this.listeners.set(name, callback);
					return () => this.listeners.delete(name);
				},
			);
		if (event === "load rejection")
			vi.spyOn(Ad.prototype, "on").mockImplementationOnce(
				function (name, callback) {
					this.load.mockRejectedValue(new Error("network"));
					this.listeners.set(name, callback);
					return () => this.listeners.delete(name);
				},
			);
		if (event === "show rejection")
			vi.spyOn(Ad.prototype, "on").mockImplementationOnce(
				function (name, callback) {
					this.show.mockRejectedValue(new Error("show"));
					this.listeners.set(name, callback);
					return () => this.listeners.delete(name);
				},
			);
		if (event === "show false")
			vi.spyOn(Ad.prototype, "on").mockImplementationOnce(
				function (name, callback) {
					this.show.mockResolvedValue(false);
					this.listeners.set(name, callback);
					return () => this.listeners.delete(name);
				},
			);
		const result = showRewardedAd();
		const assertion =
			event === "dismiss"
				? expect(result).resolves.toBe(false)
				: expect(result).rejects.toThrow("Failed");
		await flush();
		instances[0].emit(event);
		await assertion;
		expect(instances[0].listeners.size).toBe(0);
		expect(instances[0].destroy).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(0);
		const retry = showRewardedAd();
		await flush();
		instances[1].emit("reward");
		instances[1].emit("dismiss");
		await expect(retry).resolves.toBe(true);
		vi.restoreAllMocks();
	});
	it.each([
		"paid",
		"missing SDK",
		"unsupported Android",
		"no consent",
		"not initialized",
	])("does not load ads for %s", async (reason) => {
		if (reason === "paid") mocks.config.HAS_PRO = true;
		if (reason === "missing SDK") vi.stubGlobal("admob", undefined);
		if (reason === "unsupported Android") window.ANDROID_SDK_INT = 28;
		if (reason === "no consent") mocks.allowed = false;
		if (reason === "not initialized") mocks.ready = false;
		await expect(showRewardedAd()).rejects.toThrow();
		expect(instances).toHaveLength(0);
	});
	it("cancels loading and ignores late callbacks without unlocking a subsequent ad", async () => {
		let finishInit;
		mocks.start.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finishInit = resolve;
				}),
		);
		const controller = new AbortController();
		const old = showRewardedAd({ signal: controller.signal });
		controller.abort();
		await expect(old).resolves.toBe(false);
		const next = showRewardedAd();
		await flush();
		finishInit();
		await flush();
		expect(instances).toHaveLength(1);
		await expect(showRewardedAd()).rejects.toThrow("Unavailable");
		instances[0].emit("dismiss");
		await next;
	});
	it("holds the full-screen lock after cancellation until native dismissal", async () => {
		const controller = new AbortController();
		const result = showRewardedAd({ signal: controller.signal });
		await flush();
		controller.abort();
		await expect(result).resolves.toBe(false);
		expect(instances[0].destroy).not.toHaveBeenCalled();
		await expect(showRewardedAd()).rejects.toThrow("Unavailable");
		instances[0].emit("reward");
		instances[0].emit("dismiss");
		const next = showRewardedAd();
		await flush();
		instances[1].emit("dismiss");
		await next;
		expect(instances[0].listeners.size).toBe(0);
		expect(instances[0].destroy).toHaveBeenCalledOnce();
	});
	it("ignores an abandoned load rejection while a newer ad is active", async () => {
		let rejectLoad;
		vi.spyOn(Ad.prototype, "on").mockImplementationOnce(
			function (name, callback) {
				this.load.mockImplementation(
					() =>
						new Promise((resolve, reject) => {
							rejectLoad = reject;
						}),
				);
				this.listeners.set(name, callback);
				return () => this.listeners.delete(name);
			},
		);
		const controller = new AbortController();
		const old = showRewardedAd({ signal: controller.signal });
		await flush();
		controller.abort();
		await expect(old).resolves.toBe(false);
		expect(instances[0].listeners.size).toBe(0);
		expect(instances[0].destroy).toHaveBeenCalledOnce();
		const next = showRewardedAd();
		await flush();
		rejectLoad(new Error("Late failure"));
		await flush();
		expect(instances[0].show).not.toHaveBeenCalled();
		await expect(showRewardedAd()).rejects.toThrow("Unavailable");
		instances[1].emit("dismiss");
		await next;
		vi.restoreAllMocks();
	});
	it("rejects a presentation timeout and ignores late reward and dismissal", async () => {
		const result = showRewardedAd();
		const assertion = expect(result).rejects.toThrow("Failed");
		await flush();
		await vi.advanceTimersByTimeAsync(90_000);
		await assertion;
		await expect(showRewardedAd()).rejects.toThrow("Unavailable");
		expect(instances[0].destroy).not.toHaveBeenCalled();
		instances[0].emit("reward");
		instances[0].emit("dismiss");
		expect(instances[0].listeners.size).toBe(0);
		expect(instances[0].destroy).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(0);
	});
	it("times out initialization and never presents a late ad", async () => {
		let complete;
		mocks.start.mockImplementation(
			() =>
				new Promise((resolve) => {
					complete = resolve;
				}),
		);
		const result = showRewardedAd();
		const assertion = expect(result).rejects.toThrow("Failed");
		await vi.advanceTimersByTimeAsync(90_000);
		await assertion;
		complete();
		await flush();
		expect(instances).toHaveLength(0);
		expect(vi.getTimerCount()).toBe(0);
	});
});

describe("rewarded wrapper disposal", () => {
	let calls;
	beforeEach(() => {
		calls = [];
		admob.start = vi.fn().mockResolvedValue();
		vi.stubGlobal("cordova", {
			exec: vi.fn((resolve, reject, service, action, args) => {
				calls.push({ action, id: args[0].id, resolve, reject });
				if (action !== "adCreate" && action !== "adLoad") resolve();
			}),
		});
	});
	it("disposes an unused ad once without creating native resources", async () => {
		const ad = new RewardedAd({ id: "unused", adUnitId: "test" });
		expect(window.admobAds.unused).toBe(ad);
		const disposed = ad.destroy();
		expect(ad.destroy()).toBe(disposed);
		await disposed;
		expect(window.admobAds.unused).toBeUndefined();
		expect(calls).toEqual([]);
		await expect(ad.load()).rejects.toThrow("Ad is destroyed");
	});
	it.each(["SDK startup", "native creation"])(
		"cancels during %s without issuing a late load or show",
		async (phase) => {
			let started;
			if (phase === "SDK startup") {
				admob.start.mockImplementation(
					() =>
						new Promise((resolve) => {
							started = resolve;
						}),
				);
			}
			const ad = new RewardedAd({ id: "old", adUnitId: "test" });
			const loading = ad.load();
			const rejected = expect(loading).rejects.toThrow("Ad is destroyed");
			await flush();
			const disposed = ad.destroy();
			expect(ad.destroy()).toBe(disposed);
			const next = new RewardedAd({ id: "next", adUnitId: "test" });
			if (started) started();
			else calls.find(({ action }) => action === "adCreate").resolve();
			await Promise.all([disposed, rejected]);
			expect(calls.filter(({ action }) => action === "adLoad")).toEqual([]);
			expect(
				calls
					.filter(({ action }) => action === "adDestroy")
					.map(({ id }) => id),
			).toEqual(["old"]);
			expect(window.admobAds.old).toBeUndefined();
			expect(window.admobAds.next).toBe(next);
			await expect(ad.show()).rejects.toThrow("Ad is destroyed");
			await next.destroy();
		},
	);
	it("destroys a pending native load and ignores its late completion", async () => {
		const ad = new RewardedAd({ id: "loading", adUnitId: "test" });
		const loading = ad.load();
		const rejected = expect(loading).rejects.toThrow("Ad is destroyed");
		await flush();
		calls[0].resolve();
		await flush();
		const load = calls.find(({ action }) => action === "adLoad");
		cordova.exec.mockImplementation(
			(resolve, reject, service, action, args) => {
				calls.push({ action, id: args[0].id });
				load.reject(new Error("Ad is destroyed"));
				resolve();
			},
		);
		await ad.destroy();
		load.resolve();
		await rejected;
		await ad.destroy();
		expect(calls.map(({ action }) => action)).toEqual([
			"adCreate",
			"adLoad",
			"adDestroy",
		]);
		expect(window.admobAds.loading).toBeUndefined();
	});
});
