import type { NativeCallback } from "./bridge";
import bridge from "./bridge";

const { exec } = bridge("Iap");

let available = true;
let listening = false;
let purchaseListener: NativeCallback;
let purchaseError: NativeCallback;
const purchaseObservers = new Set<(purchases: Object[]) => void>();
let purchaseErrorOwner:
	| { productId: string; handler: NativeCallback }
	| undefined;
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
		purchaseListener = onSuccess;
		purchaseError = onFail;
		listen();
	},
	addPurchaseUpdatedListener(onSuccess: (purchases: Object[]) => void) {
		purchaseObservers.add(onSuccess);
		listen();
		return () => purchaseObservers.delete(onSuccess);
	},
	startConnection(
		onSuccess: (responseCode: number) => void,
		onFail: NativeCallback,
	) {
		exec(
			(responseCode: number) => {
				available = true;
				if (purchaseObservers.size || purchaseListener) listen();
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
	/** Launch a purchase; onUpdateError owns store outcomes instead of the legacy listener. */
	purchase(
		productId: string,
		onSuccess: (responseCode: number) => void,
		onFail: NativeCallback,
		onUpdateError?: NativeCallback,
	) {
		if (purchaseErrorOwner) {
			onFail?.(api.DEVELOPER_ERROR);
			return;
		}
		// Only the flow that launches this purchase owns its asynchronous errors.
		const owner = onUpdateError
			? { productId, handler: onUpdateError }
			: undefined;
		purchaseErrorOwner = owner;
		const fail = (error: unknown) => {
			if (purchaseErrorOwner === owner) purchaseErrorOwner = undefined;
			onFail?.(error);
		};
		try {
			exec(onSuccess, fail, "purchase", [productId]);
		} catch (error) {
			fail(error);
		}
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

function listen() {
	if (listening) return;
	listening = true;
	try {
		exec(
			(purchases: { productIds?: string[] }[]) => {
				if (
					purchaseErrorOwner &&
					purchases.some((purchase) =>
						purchase.productIds?.includes(purchaseErrorOwner!.productId),
					)
				)
					purchaseErrorOwner = undefined;
				for (const observer of purchaseObservers) {
					try {
						observer(purchases);
					} catch (error) {
						console.error("Purchase observer failed", error);
					}
				}
				purchaseListener?.(purchases);
			},
			(error: unknown) => {
				if (!listening) {
					console.warn("Purchase listener unavailable", error);
					return;
				}
				const handler = purchaseErrorOwner?.handler ?? purchaseError;
				purchaseErrorOwner = undefined;
				if (handler) handler(error);
				else console.warn("Unclaimed purchase error", error);
			},
			"setPurchaseUpdatedListener",
			[],
			() => {
				listening = false;
			},
		);
	} catch (error) {
		listening = false;
		console.warn("Purchase listener unavailable", error);
	}
}
