import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RewardedAd } from "../../src/native/admob/ads/rewarded";

const mocks = vi.hoisted(() => ({
	start: vi.fn(),
	config: { HAS_PRO: false },
	ready: true,
	allowed: true,
	platform: { isIOS: false },
}));
vi.mock("lib/config", () => ({ default: mocks.config }));
vi.mock("lib/platform", () => ({ default: mocks.platform }));
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
	recoverPresentation = vi.fn().mockResolvedValue(false);
}
beforeEach(async () => {
	vi.resetModules();
	vi.useFakeTimers();
	instances = [];
	mocks.config.HAS_PRO = false;
	mocks.ready = true;
	mocks.allowed = true;
	mocks.platform.isIOS = false;
	mocks.start.mockReset().mockResolvedValue();
	vi.stubGlobal("window", { ANDROID_SDK_INT: 36 });
	vi.stubGlobal("document", new EventTarget());
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
	it("allows iOS rewards without an Android SDK version", async () => {
		mocks.platform.isIOS = true;
		window.ANDROID_SDK_INT = 0;
		const result = showRewardedAd();
		await flush();
		expect(instances).toHaveLength(1);
		instances[0].emit("reward");
		instances[0].emit("dismiss");
		await expect(result).resolves.toBe(true);
	});
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
				: expect(result).rejects.toThrow(
						event.startsWith("load") ? "Unavailable" : "Failed",
					);
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
	it("releases the presentation lock if a cancelled show rejects late", async () => {
		let rejectShow;
		vi.spyOn(Ad.prototype, "on").mockImplementationOnce(
			function (name, callback) {
				this.show.mockImplementation(
					() =>
						new Promise((resolve, reject) => {
							rejectShow = reject;
						}),
				);
				this.listeners.set(name, callback);
				return () => this.listeners.delete(name);
			},
		);
		const controller = new AbortController();
		const result = showRewardedAd({ signal: controller.signal });
		await flush();
		controller.abort();
		await expect(result).resolves.toBe(false);
		rejectShow(new Error("Presentation was interrupted"));
		await flush();
		expect(instances[0].destroy).toHaveBeenCalledOnce();
		const retry = showRewardedAd();
		await flush();
		instances[1].emit("dismiss");
		await expect(retry).resolves.toBe(false);
	});
	it("does not expire while a displayed ad is being watched or on its end card", async () => {
		const result = showRewardedAd();
		await flush();
		await vi.advanceTimersByTimeAsync(180_000);
		await expect(showRewardedAd()).rejects.toThrow("Unavailable");
		instances[0].emit("reward");
		instances[0].emit("dismiss");
		await expect(result).resolves.toBe(true);
		expect(vi.getTimerCount()).toBe(0);
	});
	it.each([
		false,
		true,
	])("recovers a missed dismissal without granting a reward (iOS: %s)", async (ios) => {
		mocks.platform.isIOS = ios;
		const result = showRewardedAd();
		const rejected = expect(result).rejects.toThrow("Failed");
		await flush();
		const ad = instances[0];
		ad.recoverPresentation.mockResolvedValue(true);
		await vi.advanceTimersByTimeAsync(599_999);
		expect(ad.recoverPresentation).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		await rejected;
		expect(ad.destroy).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(0);
		const next = showRewardedAd();
		await flush();
		instances[1].emit("dismiss");
		await expect(next).resolves.toBe(false);
	});
	it("honors an earned reward only after native recovery confirms dismissal", async () => {
		const result = showRewardedAd();
		await flush();
		const ad = instances[0];
		ad.emit("reward");
		ad.recoverPresentation.mockResolvedValue(false);
		await vi.advanceTimersByTimeAsync(600_000);
		expect(ad.destroy).not.toHaveBeenCalled();
		await expect(showRewardedAd()).rejects.toThrow("Unavailable");
		ad.recoverPresentation.mockResolvedValue(true);
		await vi.advanceTimersByTimeAsync(60_000);
		await expect(result).resolves.toBe(true);
		expect(ad.destroy).toHaveBeenCalledOnce();
	});
	it("pauses visible-ad polling after three checks without unlocking and resumes safely", async () => {
		const controller = new AbortController();
		const result = showRewardedAd({ signal: controller.signal });
		await flush();
		controller.abort();
		await result;
		const ad = instances[0];
		await vi.advanceTimersByTimeAsync(3_600_000);
		expect(ad.recoverPresentation).toHaveBeenCalledTimes(3);
		expect(vi.getTimerCount()).toBe(0);
		expect(ad.destroy).not.toHaveBeenCalled();
		expect(instances).toHaveLength(1);
		ad.recoverPresentation.mockResolvedValue(true);
		document.dispatchEvent(new Event("resume"));
		await flush();
		expect(ad.destroy).toHaveBeenCalledOnce();
	});
	it("keeps the presentation lock until native recovery confirms dismissal after cancellation", async () => {
		mocks.platform.isIOS = true;
		const controller = new AbortController();
		const result = showRewardedAd({ signal: controller.signal });
		await flush();
		controller.abort();
		await expect(result).resolves.toBe(false);
		const ad = instances[0];
		ad.recoverPresentation
			.mockResolvedValueOnce(false)
			.mockRejectedValueOnce(new Error("Bridge unavailable"))
			.mockResolvedValue(true);
		await vi.advanceTimersByTimeAsync(600_000);
		expect(ad.destroy).not.toHaveBeenCalled();
		expect(instances).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(ad.destroy).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(60_000);
		expect(ad.destroy).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(0);
	});
	it("pauses recovery after three bridge errors and retries safely on resume", async () => {
		const controller = new AbortController();
		const result = showRewardedAd({ signal: controller.signal });
		await flush();
		controller.abort();
		await result;
		const ad = instances[0];
		ad.recoverPresentation.mockRejectedValue(new Error("Bridge unavailable"));
		await vi.advanceTimersByTimeAsync(900_000);
		expect(ad.recoverPresentation).toHaveBeenCalledTimes(3);
		expect(vi.getTimerCount()).toBe(0);
		expect(ad.destroy).not.toHaveBeenCalled();
		expect(instances).toHaveLength(1);
		ad.recoverPresentation.mockResolvedValue(true);
		document.dispatchEvent(new Event("resume"));
		await flush();
		expect(ad.destroy).toHaveBeenCalledOnce();
		document.dispatchEvent(new Event("resume"));
		expect(ad.recoverPresentation).toHaveBeenCalledTimes(4);
	});
	it("does not recover while the first show request is still opening", async () => {
		let acknowledge;
		vi.spyOn(Ad.prototype, "on").mockImplementationOnce(
			function (name, callback) {
				this.show.mockImplementation(
					() =>
						new Promise((resolve) => {
							acknowledge = resolve;
						}),
				);
				this.listeners.set(name, callback);
				return () => this.listeners.delete(name);
			},
		);
		const previous = showRewardedAd();
		await flush();
		await expect(showRewardedAd()).rejects.toThrow("Unavailable");
		expect(instances[0].recoverPresentation).not.toHaveBeenCalled();
		acknowledge();
		await flush();
		instances[0].emit("dismiss");
		await expect(previous).resolves.toBe(false);
	});
	it("recovers on the next user request after polling stops without a resume event", async () => {
		const controller = new AbortController();
		const previous = showRewardedAd({ signal: controller.signal });
		await vi.advanceTimersByTimeAsync(0);
		controller.abort();
		await previous;
		await vi.advanceTimersByTimeAsync(3_600_000);
		expect(instances[0].recoverPresentation).toHaveBeenCalledTimes(3);
		instances[0].recoverPresentation.mockResolvedValue(true);
		const next = showRewardedAd();
		await vi.advanceTimersByTimeAsync(0);
		expect(instances).toHaveLength(2);
		instances[1].emit("dismiss");
		await expect(next).resolves.toBe(false);
	});
	it("bounds a hung recovery call and ignores its late success", async () => {
		const controller = new AbortController();
		const previous = showRewardedAd({ signal: controller.signal });
		await vi.advanceTimersByTimeAsync(0);
		controller.abort();
		await previous;
		let complete;
		const ad = instances[0];
		ad.recoverPresentation.mockImplementation(
			() =>
				new Promise((resolve) => {
					complete = resolve;
				}),
		);
		const next = showRewardedAd();
		const rejected = expect(next).rejects.toThrow("Unavailable");
		await vi.advanceTimersByTimeAsync(10_000);
		await rejected;
		complete(true);
		await vi.advanceTimersByTimeAsync(0);
		expect(ad.destroy).not.toHaveBeenCalled();
		expect(instances).toHaveLength(1);
		ad.recoverPresentation.mockResolvedValue(true);
		const retry = showRewardedAd();
		await vi.advanceTimersByTimeAsync(0);
		expect(instances).toHaveLength(2);
		instances[1].emit("dismiss");
		await expect(retry).resolves.toBe(false);
		expect(vi.getTimerCount()).toBe(0);
	});
	it("coalesces user recovery attempts and releases them on normal dismissal", async () => {
		const previous = showRewardedAd();
		await vi.advanceTimersByTimeAsync(0);
		const ad = instances[0];
		ad.recoverPresentation.mockImplementation(() => new Promise(() => {}));
		const first = showRewardedAd();
		const second = showRewardedAd();
		const secondRejected = expect(second).rejects.toThrow("Unavailable");
		await vi.advanceTimersByTimeAsync(0);
		expect(ad.recoverPresentation).toHaveBeenCalledOnce();
		ad.emit("dismiss");
		await expect(previous).resolves.toBe(false);
		await vi.advanceTimersByTimeAsync(0);
		await secondRejected;
		expect(instances).toHaveLength(2);
		instances[1].emit("dismiss");
		await expect(first).resolves.toBe(false);
		expect(vi.getTimerCount()).toBe(0);
	});
	it("reports expected unavailability without a warning", async () => {
		const warn = vi.spyOn(console, "warn");
		mocks.allowed = false;
		await expect(showRewardedAd()).rejects.toThrow("Unavailable");
		expect(warn).not.toHaveBeenCalled();
	});
	it("recovers the presentation lock when the show reply itself is lost", async () => {
		mocks.platform.isIOS = true;
		vi.spyOn(Ad.prototype, "on").mockImplementationOnce(
			function (name, callback) {
				this.show.mockImplementation(() => new Promise(() => {}));
				this.recoverPresentation.mockResolvedValue(true);
				this.listeners.set(name, callback);
				return () => this.listeners.delete(name);
			},
		);
		const result = showRewardedAd();
		const rejected = expect(result).rejects.toThrow("Failed");
		await vi.advanceTimersByTimeAsync(90_000);
		await rejected;
		expect(instances[0].destroy).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(510_000);
		expect(instances[0].destroy).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(0);
	});
	it("ignores a late recovery response after normal dismissal and a new ad", async () => {
		mocks.platform.isIOS = true;
		const result = showRewardedAd();
		await flush();
		let complete;
		instances[0].recoverPresentation.mockImplementation(
			() =>
				new Promise((resolve) => {
					complete = resolve;
				}),
		);
		await vi.advanceTimersByTimeAsync(600_000);
		instances[0].emit("dismiss");
		await expect(result).resolves.toBe(false);
		const next = showRewardedAd();
		await flush();
		complete(true);
		await flush();
		await expect(showRewardedAd()).rejects.toThrow("Unavailable");
		expect(instances[1].destroy).not.toHaveBeenCalled();
		instances[1].emit("dismiss");
		await next;
		expect(vi.getTimerCount()).toBe(0);
	});
	it("lets users finish privacy prompts without an ad timeout", async () => {
		let complete;
		mocks.start.mockImplementation(
			() =>
				new Promise((resolve) => {
					complete = resolve;
				}),
		);
		const result = showRewardedAd();
		await vi.advanceTimersByTimeAsync(180_000);
		expect(instances).toHaveLength(0);
		expect(vi.getTimerCount()).toBe(0);
		complete();
		await flush();
		instances[0].emit("reward");
		instances[0].emit("dismiss");
		await expect(result).resolves.toBe(true);
	});
	it("times out a stalled load without showing or granting a late reward", async () => {
		let complete;
		vi.spyOn(Ad.prototype, "on").mockImplementationOnce(
			function (name, callback) {
				this.load.mockImplementation(
					() =>
						new Promise((resolve) => {
							complete = resolve;
						}),
				);
				this.listeners.set(name, callback);
				return () => this.listeners.delete(name);
			},
		);
		const result = showRewardedAd();
		const assertion = expect(result).rejects.toThrow("Unavailable");
		await flush();
		await vi.advanceTimersByTimeAsync(90_000);
		await assertion;
		complete();
		await flush();
		expect(instances[0].show).not.toHaveBeenCalled();
		expect(instances[0].destroy).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(0);
	});
});

describe("rewarded wrapper disposal", () => {
	let calls;
	beforeEach(() => {
		calls = [];
		admob.start = vi.fn().mockResolvedValue();
		vi.stubGlobal("Bridge", {
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
	it.each([
		"SDK startup",
		"native creation",
	])("cancels during %s without issuing a late load or show", async (phase) => {
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
			calls.filter(({ action }) => action === "adDestroy").map(({ id }) => id),
		).toEqual(["old"]);
		expect(window.admobAds.old).toBeUndefined();
		expect(window.admobAds.next).toBe(next);
		await expect(ad.show()).rejects.toThrow("Ad is destroyed");
		await next.destroy();
	});
	it("destroys a pending native load and ignores its late completion", async () => {
		const ad = new RewardedAd({ id: "loading", adUnitId: "test" });
		const loading = ad.load();
		const rejected = expect(loading).rejects.toThrow("Ad is destroyed");
		await flush();
		calls[0].resolve();
		await flush();
		const load = calls.find(({ action }) => action === "adLoad");
		Bridge.exec.mockImplementation((resolve, reject, service, action, args) => {
			calls.push({ action, id: args[0].id });
			load.reject(new Error("Ad is destroyed"));
			resolve();
		});
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
