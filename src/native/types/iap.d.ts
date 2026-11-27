interface Iap {
	getProducts(
		skuList: Array<string>,
		onSuccess: (skuList: Array<Object>) => void,
		onError: (err: String) => Error,
	): void;
	setPurchaseUpdatedListener(
		onSuccess: (purchase: Object) => void,
		onError: (err: string) => void,
	): void;
	startConnection(
		onSuccess: (responseCode: number) => void,
		onError: (err: string) => void,
	): void;
	consume(
		purchaseToken: string,
		onSuccess: (responseCode: number) => void,
		onError: (err: string) => void,
	): void;
	purchase(
		skuId: string,
		onSuccess: (responseCode: number) => void,
		onError: (err: string) => void,
	): void;
	getPurchases(
		onSuccess: (purchaseList: Array<Object>) => void,
		onError: (err: string) => void,
	): void;
	restorePurchases(
		onSuccess: (purchaseList: Array<Object>) => void,
		onError: (err: string) => void,
	): void;
	OK: 0;
	BILLING_UNAVAILABLE: 3;
	DEVELOPER_ERROR: 5;
	ERROR: 6;
	FEATURE_NOT_SUPPORTED: -2;
	ITEM_ALREADY_OWNED: 7;
	ITEM_NOT_OWNED: 8;
	ITEM_UNAVAILABLE: 4;
	SERVICE_DISCONNECTED: -1;
	SERVICE_TIMEOUT: -3;
	SERVICE_UNAVAILABLE: 2;
	USER_CANCELED: 1;
	PURCHASE_STATE_PURCHASED: 1;
	PURCHASE_STATE_PENDING: 2;
	PURCHASE_STATE_UNKNOWN: 0;
}

declare const iap: typeof import("../iap").default;
