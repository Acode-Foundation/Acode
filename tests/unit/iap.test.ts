import iap from "native/iap";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const exec = vi.fn();

beforeEach(() => {
	exec.mockReset();
	vi.stubGlobal("Bridge", { platformId: "ios", exec });
});
afterEach(() => vi.unstubAllGlobals());

test("restoration synchronizes App Store purchases and retains Android's purchase query", () => {
	const success = vi.fn();
	const failure = vi.fn();
	iap.restorePurchases(success, failure);
	expect(exec).toHaveBeenLastCalledWith(
		success,
		failure,
		"Iap",
		"restorePurchases",
		[],
	);
	vi.stubGlobal("Bridge", { platformId: "android", exec });
	iap.restorePurchases(success, failure);
	expect(exec).toHaveBeenLastCalledWith(
		success,
		failure,
		"Iap",
		"getPurchases",
		[],
	);
});

test("billing availability is current inside callbacks and recovers after restrictions are lifted", () => {
	exec.mockImplementation((success, failure) => failure(3));
	const unavailable = vi.fn(() => expect(iap.isIapAvailable()).toBe(false));
	iap.startConnection(vi.fn(), unavailable);
	expect(unavailable).toHaveBeenCalledWith(3);
	exec.mockImplementation((success) => success(0));
	const connected = vi.fn(() => expect(iap.isIapAvailable()).toBe(true));
	iap.startConnection(connected, vi.fn());
	expect(connected).toHaveBeenCalledWith(0);
});
