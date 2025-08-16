import purchaseListener from "handlers/purchase";
import helpers from "utils/helpers";

/**
 * Remove ads after purchase
 * @returns {Promise<void>}
 */
export default function removeAds() {
	return new Promise((resolve, reject) => {
		iap.getProducts(["acode_pro_new"], (products) => {
			const [product] = products;

			iap.setPurchaseUpdatedListener(...purchaseListener(onpurchase, reject));

			iap.purchase(
				product.productId,
				(code) => {
					// ignore
				},
				(err) => {
					alert(strings.error, err);
				},
			);
		});

		function onpurchase() {
			resolve(null);
			helpers.hideAd(true);
			localStorage.setItem("acode_pro", "true");
			window.IS_FREE_VERSION = false;
			toast(strings["thank you :)"]);
		}
	});
}
