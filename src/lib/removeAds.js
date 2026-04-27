import purchaseListener from "handlers/purchase";
import { hideAd } from "./startAd.js";
import config from "./config.js";

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
			hideAd(true);
			localStorage.setItem("acode_pro", "true");
			config.HAS_PRO = true;
			toast(strings["thank you :)"]);
		}
	});
}
