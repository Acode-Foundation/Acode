import type { NativeCallback } from "./bridge";
import bridge from "./bridge";

const { exec } = bridge("Iap");

let available = true;
const api = {
	getProducts(
		productIds: string[],
		onSuccess: (skuList: Object[]) => void,
		onFail: (err: String) => Error,
	) {
		exec(onSuccess, onFail, "getProducts", [productIds]);
	},
	setPurchaseUpdatedListener(
		onSuccess: (purchase: Object) => void,
		onFail: NativeCallback,
	) {
		exec(onSuccess, onFail, "setPurchaseUpdatedListener", []);
	},
	startConnection(
		onSuccess: (responseCode: number) => void,
		onFail: NativeCallback,
	) {
		exec(
			(responseCode: number) => {
				available = true;
				onSuccess?.(responseCode);
			},
			function (error: number) {
				available = error !== 3;
				onFail?.(error);
			},
			"startConnection",
			[],
		);
	},
	consume(
		purchaseToken: string,
		onSuccess: (responseCode: number) => void,
		onFail: NativeCallback,
	) {
		exec(onSuccess, onFail, "consume", [purchaseToken]);
	},
	purchase(
		productId: string,
		onSuccess: (responseCode: number) => void,
		onFail: NativeCallback,
	) {
		exec(onSuccess, onFail, "purchase", [productId]);
	},
	getPurchases(
		onSuccess: (purchaseList: Object[]) => void,
		onFail: NativeCallback,
	) {
		exec(onSuccess, onFail, "getPurchases", []);
	},
	restorePurchases(
		onSuccess: (purchaseList: Object[]) => void,
		onFail: NativeCallback,
	) {
		const action =
			Bridge.platformId === "ios" ? "restorePurchases" : "getPurchases";
		exec(onSuccess, onFail, action, []);
	},
	acknowledgePurchase(
		purchaseToken: string,
		onSuccess: NativeCallback,
		onFail: NativeCallback,
	) {
		exec(onSuccess, onFail, "acknowledgePurchase", [purchaseToken]);
	},
	isIapAvailable() {
		return available;
	},
	BILLING_UNAVAILABLE: 3,
	DEVELOPER_ERROR: 5,
	ERROR: 6,
	FEATURE_NOT_SUPPORTED: -2,
	ITEM_ALREADY_OWNED: 7,
	ITEM_NOT_OWNED: 8,
	ITEM_UNAVAILABLE: 4,
	OK: 0,
	SERVICE_DISCONNECTED: -1,
	SERVICE_TIMEOUT: 2,
	USER_CANCELED: 1,
	PURCHASE_STATE_PURCHASED: 1,
	PURCHASE_STATE_PENDING: 2,
	PURCHASE_STATE_UNKNOWN: 0,
};

export default api;
