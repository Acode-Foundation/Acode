import helpers from "utils/helpers";

export default function purchaseListener(onpurchase, onerror, productId) {
	return [
		(purchases) => {
			const purchase = productId
				? purchases?.find((item) => item.productIds?.includes(productId))
				: purchases?.[0];
			if (productId && purchases?.length && !purchase) return;
			if (!purchase) {
				onerror?.(strings.failed);
				return;
			}
			if (purchase.purchaseState === iap.PURCHASE_STATE_PURCHASED) {
				if (!purchase.isAcknowledged) {
					iap.acknowledgePurchase(
						purchase.purchaseToken,
						() => {
							onpurchase();
						},
						(error) => {
							if (typeof onerror === "function") onerror(error);
						},
					);
					return;
				}
				onpurchase();
				return;
			}

			const message =
				purchase.purchaseState === iap.PURCHASE_STATE_PENDING
					? strings["purchase pending"]
					: strings.failed;

			helpers.error(message);
			if (typeof onerror === "function") onerror(message);
		},
		(error) => {
			if (error === iap.ITEM_ALREADY_OWNED) {
				onpurchase();
				return;
			}

			let message =
				error === iap.USER_CANCELED ? strings.canceled : strings.failed;

			if (typeof onerror === "function") onerror(message);
		},
	];
}
