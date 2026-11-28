import config from "lib/config";
import sponsorDetails from "./details";
import pending from "./pending";

export default function sponsorPurchases(onSuccess, onError, onSettled) {
	const completed = new Set();
	const deferred = new Set();
	let active = null;
	let rerun = false;
	return receive;

	async function receive(purchases = [], retryCancelled = true) {
		try {
			// Persist the whole batch before any network call or recovery prompt.
			pending.remember(purchases, completed);
			if (retryCancelled) deferred.clear();
			if (active) {
				rerun = true;
				return await active;
			}
			active = Promise.resolve().then(process);
			await active;
		} catch (error) {
			onError(error);
		} finally {
			onSettled();
		}
	}

	async function process() {
		const attempted = new Set();
		try {
			do {
				rerun = false;
				for (const record of pending.list()) {
					const { purchase } = record;
					const id = pending.identity(purchase);
					if (completed.has(id) || deferred.has(id) || attempted.has(id))
						continue;
					attempted.add(id);
					try {
						if (record.registered !== config.API_BASE) {
							if (
								typeof record.details?.name !== "string" ||
								!record.details.name.trim()
							) {
								const [productId] = purchase.productIds;
								record.details = await sponsorDetails(
									productId,
									productId,
									true,
								);
								if (!record.details) {
									deferred.add(id);
									continue;
								}
							}
							pending.save(record);
							await register(record);
							record.registered = config.API_BASE;
							pending.save(record);
						}
						// The durable server receipt precedes finishing on either store.
						await finish(purchase);
						pending.remove(purchase);
						completed.add(id);
						clearDraft(record);
						onSuccess();
					} catch (error) {
						if (error.status === 400) {
							clearDraft(record);
							record.details = null;
							pending.save(record);
						}
						onError(error);
					}
				}
			} while (rerun);
		} finally {
			active = null;
		}
	}
}

function clearDraft({ purchase, details }) {
	const key = `sponsor_${purchase.productIds[0]}`;
	if (localStorage.getItem(key) === JSON.stringify(details))
		localStorage.removeItem(key);
}

async function register({ purchase, details }) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 15000);
	try {
		const response = await fetch(`${config.API_BASE}/sponsor`, {
			method: "POST",
			signal: controller.signal,
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				...details,
				tier: purchase.productIds[0],
				packageName: BuildInfo.packageName,
				purchaseToken: purchase.purchaseToken,
			}),
		});
		// Only the sponsor endpoint's JSON acknowledgement can authorize finishing.
		if (response.redirected)
			throw new Error("Sponsorship registration was redirected. Please retry.");
		const result = await response.json().catch(() => null);
		if (!result || typeof result !== "object" || Array.isArray(result))
			throw new Error(
				"Invalid sponsorship response. Your purchase is saved for retry.",
			);
		if (!response.ok || result.error) {
			const message = String(
				result.error || "Unable to register sponsorship",
			).trim();
			throw Object.assign(
				new Error(
					response.status === 400
						? `${message.replace(/[.!?]+$/, "")}. Reopen Sponsorship to correct your details. Your purchase is saved.`
						: message,
				),
				{ status: response.status },
			);
		}
	} finally {
		clearTimeout(timer);
	}
}

function finish(purchase) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error("Finishing purchase timed out")),
			5000,
		);
		const settle = (code) => {
			clearTimeout(timer);
			// A restart can happen after consume succeeds but before local cleanup.
			if (code === iap.OK || code === iap.ITEM_NOT_OWNED) resolve();
			else reject(new Error(`Unable to finish purchase: ${code}`));
		};
		try {
			iap.consume(purchase.purchaseToken, settle, settle);
		} catch (error) {
			clearTimeout(timer);
			reject(error);
		}
	});
}
