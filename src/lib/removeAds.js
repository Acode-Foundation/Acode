import toast from "components/toast";
import confirm from "dialogs/confirm";
import loader from "dialogs/loader";
import purchaseListener from "handlers/purchase";
import helpers from "utils/helpers";
import auth from "./auth";
import config from "./config";
import customTab from "./customTab";
import { BANNER_SUPPRESSION_REASON, setBannerSuppressed } from "./startAd";

let activePurchase = null;
let activeRequest = null;

function enablePro() {
	config.HAS_PRO = true;
	setBannerSuppressed(BANNER_SUPPRESSION_REASON.PRO, true);
}

/** Purchase Pro through Play billing. Resolves only after purchase confirmation. */
export default function removeAds({ signal } = {}) {
	if (signal?.aborted) return Promise.reject(strings.canceled);
	if (activePurchase) return activePurchase;
	activePurchase = new Promise((resolve, reject) => {
		let settled = false;
		let launched = false;
		let purchased = false;
		function cancel() {
			if (!launched) fail(strings.canceled);
		}
		function fail(error) {
			if (settled) return;
			settled = true;
			signal?.removeEventListener("abort", cancel);
			reject(error);
		}
		function onpurchase() {
			// A pending purchase can be confirmed after the caller has settled.
			if (purchased) return;
			purchased = true;
			settled = true;
			signal?.removeEventListener("abort", cancel);
			enablePro();
			// The cache is reverified by the existing startup purchase checks.
			try {
				localStorage.setItem("acode_pro", "true");
			} catch (error) {
				console.warn("Unable to cache Pro purchase", error);
			}
			toast(strings["thank you :)"]);
			resolve();
		}
		signal?.addEventListener("abort", cancel, { once: true });
		try {
			iap.getProducts(
				["acode_pro_new"],
				(products) => {
					if (settled) return;
					try {
						const product = products?.find(
							({ productId }) => productId === "acode_pro_new",
						);
						if (!product) return fail(strings["no-product-info"]);
						iap.setPurchaseUpdatedListener(
							...purchaseListener(onpurchase, fail),
						);
						launched = true;
						iap.purchase(product.productId, () => {}, fail);
					} catch (error) {
						fail(error);
					}
				},
				fail,
			);
		} catch (error) {
			fail(error);
		}
	}).finally(() => {
		activePurchase = null;
	});
	return activePurchase;
}

/** Reuse the Remove ads entry point; external checkout completes via its intent. */
export function requestProPurchase({ signal } = {}) {
	if (signal?.aborted) return Promise.resolve(false);
	if (config.HAS_PRO) return Promise.resolve(true);
	if (activeRequest) return activeRequest;
	activeRequest = (async () => {
		if (!helpers.shouldAllowExternalPurchase()) {
			try {
				await removeAds({ signal });
				return config.HAS_PRO;
			} catch (error) {
				if (
					error === strings.canceled ||
					error === globalThis.iap?.USER_CANCELED
				)
					return false;
				throw error;
			}
		}

		loader.create(strings.login, strings["loading..."]);
		try {
			let user = await auth.getLoggedInUser();
			if (signal?.aborted) return false;
			if (!user) {
				// Dismiss the modal loader so Android Back can cancel confirmation.
				loader.destroy();
				const confirmed = await confirm(
					strings.confirm,
					strings["confirm-login"],
					false,
					{ signal },
				);
				if (!confirmed || signal?.aborted) return false;
				loader.create(strings.login, strings["loading..."]);
				await auth.login();
				if (signal?.aborted) return false;
				user = await auth.getLoggedInUser();
			}
			if (signal?.aborted) return false;
			if (!user) throw new Error(strings.failed);
			if (user.acode_pro) {
				enablePro();
				return true;
			}
		} finally {
			loader.destroy();
		}
		if (signal?.aborted) return false;
		await customTab(`${config.BASE_URL}/pro?redirect=app`);
		return config.HAS_PRO;
	})().finally(() => {
		activeRequest = null;
	});
	return activeRequest;
}
