import config from "lib/config";
import helpers from "utils/helpers";

export default { list, remember, save, remove, identity };

function storageKey() {
	return `sponsor_pending_${BuildInfo.packageName}`;
}

function identity(purchase) {
	return purchase.store === "appstore" && purchase.transactionId
		? `appstore:${purchase.environment}:${purchase.transactionId}`
		: purchase.purchaseToken;
}

function list() {
	const records = helpers.parseJSON(localStorage.getItem(storageKey()));
	// Only supported tiers can be registered; the next journal write prunes others.
	return Array.isArray(records)
		? records.filter((record) => isSponsorPurchase(record?.purchase))
		: [];
}

function isSponsorPurchase(purchase) {
	return (
		config.SKU_LIST.includes(purchase?.productIds?.[0]) &&
		purchase.purchaseState === iap.PURCHASE_STATE_PURCHASED &&
		typeof purchase.purchaseToken === "string" &&
		Boolean(purchase.purchaseToken)
	);
}

function remember(purchases, completed) {
	const records = list();
	for (const purchase of purchases || []) {
		if (!isSponsorPurchase(purchase) || completed.has(identity(purchase)))
			continue;
		const existing = records.find(
			(record) => identity(record.purchase) === identity(purchase),
		);
		if (existing) {
			existing.purchase = purchase;
		} else {
			const [productId] = purchase.productIds;
			records.push({
				purchase,
				details: helpers.parseJSON(
					localStorage.getItem(`sponsor_${productId}`),
				),
				registered: false,
			});
		}
	}
	write(records);
}

function save(record) {
	const records = list();
	const index = records.findIndex(
		(item) => identity(item.purchase) === identity(record.purchase),
	);
	if (index < 0) records.push(record);
	else records[index] = record;
	write(records);
}

function remove(purchase) {
	write(
		list().filter((record) => identity(record.purchase) !== identity(purchase)),
	);
}

function write(records) {
	if (records.length)
		localStorage.setItem(storageKey(), JSON.stringify(records));
	else localStorage.removeItem(storageKey());
}
