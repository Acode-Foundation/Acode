let iap: typeof import("native/iap").default;

import { afterEach, beforeEach, expect, test, vi } from "vitest";

const exec = vi.fn();

beforeEach(async () => {
	vi.resetModules();
	iap = (await import("native/iap")).default;
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

test("purchase observers survive legacy listener replacement without replacing the native listener", () => {
	const observer = vi.fn();
	const remove = iap.addPurchaseUpdatedListener(observer);
	const first = vi.fn();
	const second = vi.fn();
	const failure = vi.fn();
	iap.setPurchaseUpdatedListener(first, failure);
	iap.setPurchaseUpdatedListener(second, failure);
	expect(exec).toHaveBeenCalledOnce();
	const [receive, onError] = exec.mock.calls[0];
	const purchases = [{ productIds: ["crystal"], purchaseState: 1 }];
	receive(purchases);
	expect(observer).toHaveBeenCalledWith(purchases);
	expect(first).not.toHaveBeenCalled();
	expect(second).toHaveBeenCalledWith(purchases);
	onError(1);
	expect(failure).toHaveBeenCalledWith(1);
	remove();
	receive(purchases);
	expect(observer).toHaveBeenCalledOnce();
});

test.each([
	false,
	true,
])("reconnect retries failed purchase observation (throws: %s)", (throws) => {
	const observer = vi.fn();
	const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
	try {
		exec.mockImplementationOnce(
			(success, failure, service, action, args, release) => {
				if (throws) throw new Error("Bridge unavailable");
				release();
				failure("Bridge unavailable");
			},
		);
		iap.addPurchaseUpdatedListener(observer);
		exec.mockImplementation((success, failure, service, action) => {
			if (action === "startConnection") success(0);
		});
		iap.startConnection(vi.fn(), vi.fn());
		const registrations = exec.mock.calls.filter(
			(call) => call[3] === "setPurchaseUpdatedListener",
		);
		expect(registrations).toHaveLength(2);
		const purchases = [{ productIds: ["crystal"], purchaseState: 1 }];
		registrations[1][0](purchases);
		expect(observer).toHaveBeenCalledOnce();
		expect(observer).toHaveBeenCalledWith(purchases);
	} finally {
		warning.mockRestore();
	}
});

test.each([
	-1, 1, 2, 6,
])("billing outcome %s preserves the subscription and reaches only the purchasing flow", (code) => {
	const observer = vi.fn();
	const error = vi.fn();
	const legacyError = vi.fn();
	const remove = iap.addPurchaseUpdatedListener(observer);
	iap.setPurchaseUpdatedListener(vi.fn(), legacyError);
	const [receive, onError] = exec.mock.calls[0];
	iap.purchase("crystal", vi.fn(), vi.fn(), error);
	onError(code);
	expect(error).toHaveBeenCalledWith(code);
	expect(legacyError).not.toHaveBeenCalled();
	exec.mockImplementation((success, failure, service, action) => {
		if (action === "startConnection") success(0);
	});
	iap.startConnection(vi.fn(), vi.fn());
	expect(
		exec.mock.calls.filter((call) => call[3] === "setPurchaseUpdatedListener"),
	).toHaveLength(1);
	receive([]);
	expect(observer).toHaveBeenCalledOnce();
	remove();
	iap.purchase("acode_pro_new", vi.fn(), vi.fn());
	onError(code);
	expect(error).toHaveBeenCalledOnce();
	expect(legacyError).toHaveBeenCalledOnce();
});

test("registration failure does not become a purchase error and the released subscription retries", () => {
	const failure = vi.fn();
	const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
	try {
		iap.setPurchaseUpdatedListener(vi.fn(), failure);
		const [, onError, , , , release] = exec.mock.calls[0];
		release();
		onError(-1);
		expect(failure).not.toHaveBeenCalled();
		iap.addPurchaseUpdatedListener(vi.fn());
		expect(exec).toHaveBeenCalledTimes(2);
	} finally {
		warning.mockRestore();
	}
});

test("purchase updates release scoped error ownership while unrelated updates do not", () => {
	const scoped = vi.fn();
	const legacy = vi.fn();
	const blocked = vi.fn();
	iap.setPurchaseUpdatedListener(vi.fn(), legacy);
	const [receive, onError] = exec.mock.calls[0];
	iap.purchase("gold", vi.fn(), vi.fn(), scoped);
	receive([{ productIds: ["unrelated"], purchaseState: 1 }]);
	iap.purchase("acode_pro_new", vi.fn(), blocked);
	expect(blocked).toHaveBeenCalledWith(iap.DEVELOPER_ERROR);
	receive([{ productIds: ["gold"], purchaseState: 2 }]);
	iap.purchase("acode_pro_new", vi.fn(), vi.fn());
	onError(1);
	expect(scoped).not.toHaveBeenCalled();
	expect(legacy).toHaveBeenCalledWith(1);
});
