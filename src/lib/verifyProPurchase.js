import helpers from "utils/helpers";
import config from "./config";
import platform from "./platform";
import { BANNER_SUPPRESSION_REASON, setBannerSuppressed } from "./startAd";

/**
 * A billing service that never answers must not keep the app on the splash
 * screen, so startup stops waiting for the purchase check after this long.
 */
export const PRO_CHECK_TIMEOUT_MS = 5000;

/**
 * Confirms Pro status against the store's purchases, waiting at most
 * PRO_CHECK_TIMEOUT_MS. Only a change made here is applied, so an upgrade
 * from another source (e.g. a login) is never downgraded. A result that
 * arrives after the timeout can only upgrade this session, because startup
 * has already moved on with the current status.
 * @param {boolean} isFreePackage
 * @param {{log(level: string, message: unknown): void}} logger
 */
export default async function verifyProPurchase(isFreePackage, logger) {
	const initialHasPro = config.HAS_PRO;
	let timedOut = false;
	const check = findProPurchase(logger).then((isPro) => {
		if (isPro) {
			config.HAS_PRO = true;
			// Ads may have started while a slow check was still pending.
			setBannerSuppressed(BANNER_SUPPRESSION_REASON.PRO, true);
			// Lets the next Android launch skip waiting for this check.
			localStorage.setItem("acode_pro", "true");
		} else if (isPro === false) {
			// A refunded or revoked purchase must not come back offline, even
			// when the result is too late to change this session. A purchase or
			// login that upgraded the session meanwhile keeps its cache.
			if (!config.HAS_PRO || initialHasPro) {
				localStorage.removeItem("acode_pro");
			}
			if (!timedOut && config.HAS_PRO === initialHasPro) {
				config.HAS_PRO = !isFreePackage;
			}
		}
	});
	await new Promise((resolve) => {
		const timer = setTimeout(() => {
			timedOut = true;
			logger.log(
				"warn",
				`Purchase check still pending after ${PRO_CHECK_TIMEOUT_MS}ms`,
			);
			resolve();
		}, PRO_CHECK_TIMEOUT_MS);
		const settle = (error) => {
			if (error) console.error(error);
			clearTimeout(timer);
			resolve();
		};
		check.then(() => settle(), settle);
	});
}

/**
 * @returns {Promise<boolean|null>} whether Pro was purchased, or null when
 * the store could not tell
 */
async function findProPurchase(logger) {
	try {
		await helpers.promisify(iap.startConnection).catch((e) => {
			logger.log("error", "connection error");
			logger.log("error", e);
		});

		if (!platform.isIOS && !navigator.onLine) return null;

		const purchases = await helpers.promisify(iap.getPurchases);
		return purchases.some(
			(purchase) =>
				purchase.purchaseState === iap.PURCHASE_STATE_PURCHASED &&
				purchase.productIds.includes("acode_pro_new"),
		);
	} catch (error) {
		logger.log("error", "Purchase error");
		logger.log("error", error);
		return null;
	}
}
