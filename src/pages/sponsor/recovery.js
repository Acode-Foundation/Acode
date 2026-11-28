import dialog from "dialogs/dialog";
import helpers from "utils/helpers";
import pending from "./pending";
import sponsorPurchases from "./purchases";

const listeners = new Set();
let started = false;
let observing = false;
let receiver;
let checking;
let checkingProducts;
let retryRequested = false;

export default function startSponsorRecovery(retryCancelled = false) {
	if (typeof iap === "undefined") return Promise.resolve(null);
	if (!started) {
		started = true;
		document.addEventListener("resume", retry);
		window.addEventListener("online", retry);
	}
	return recoverSponsorPurchases(retryCancelled);
}

export function subscribeSponsorPurchases(listener) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function recoverSponsorPurchases(retryCancelled = false) {
	if (typeof iap === "undefined") return Promise.resolve(null);
	if (!observing) {
		try {
			iap.addPurchaseUpdatedListener(receivePurchases);
			observing = true;
		} catch (error) {
			console.warn("Unable to observe sponsor purchases", error);
		}
	}
	retryRequested ||= retryCancelled;
	if (checking) return checking;
	checkingProducts = new Set();
	checking = check(checkingProducts).finally(() => {
		checking = null;
		checkingProducts = null;
	});
	return checking;
}

async function check(products) {
	let purchases = [];
	let queried = false;
	try {
		purchases = await queryPurchases();
		queried = true;
	} catch (error) {
		console.warn("Unable to query sponsor purchases", error);
	}
	rememberProducts(products, [
		...pending.list().map(({ purchase }) => purchase),
		...purchases,
	]);
	do {
		const retryCancelled = retryRequested;
		retryRequested = false;
		await getReceiver()(purchases, retryCancelled);
		purchases = [];
	} while (retryRequested);
	// Do not start another charge when the store could not check ownership.
	return queried ? products : null;
}

function queryPurchases() {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error("Purchase query timed out")),
			5000,
		);
		const fail = (error) => {
			clearTimeout(timer);
			reject(error);
		};
		const query = () =>
			iap.getPurchases((purchases) => {
				clearTimeout(timer);
				resolve(purchases || []);
			}, fail);
		try {
			// Restrictions on new payments must not block existing StoreKit receipts.
			iap.startConnection(query, query);
		} catch (error) {
			fail(error);
		}
	});
}

function retry() {
	void recoverSponsorPurchases().catch(console.error);
}

function receivePurchases(purchases) {
	// Keep delivered tiers even when processing finishes and removes their journal.
	if (checkingProducts) rememberProducts(checkingProducts, purchases);
	return getReceiver()(purchases, false);
}

function rememberProducts(products, purchases) {
	for (const purchase of purchases || []) {
		for (const id of purchase.productIds || []) products.add(id);
	}
}

function getReceiver() {
	if (!receiver)
		receiver = sponsorPurchases(
			() => {
				dialog(strings.info, "<p>Thank you for supporting Acode!</p>");
				emit("success");
			},
			(error) => {
				helpers.error(error);
				emit("error");
			},
			() => emit("settled"),
		);
	return receiver;
}

function emit(event) {
	for (const listener of listeners) listener(event);
}
