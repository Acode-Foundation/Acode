import { vi } from "vitest";
import { loadSourceModule } from "./loadSourceModule";

export default function setupSponsorPurchases(packageName = "app.acode") {
	localStorage.clear();
	localStorage.setItem(
		"sponsor_crystal",
		JSON.stringify({ name: "Sponsor", public: true }),
	);
	const iap = {
		OK: 0,
		PURCHASE_STATE_PURCHASED: 1,
		ITEM_NOT_OWNED: 8,
		consume: vi.fn((token, resolve) => resolve(0)),
	};
	const fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
	const success = vi.fn();
	const error = vi.fn();
	const settled = vi.fn();
	const recoverDetails = vi.fn(async (productId) => {
		const details = { name: "Recovered Sponsor", public: false };
		localStorage.setItem(`sponsor_${productId}`, JSON.stringify(details));
		return details;
	});
	const config = {
		SKU_LIST: ["crystal", "gold"],
		API_BASE: "https://example.test/api",
	};
	const helpers = {
		parseJSON(value) {
			try {
				return JSON.parse(value);
			} catch {
				return null;
			}
		},
	};
	const globals = {
		iap,
		fetch,
		localStorage,
		AbortController,
		setTimeout,
		clearTimeout,
		BuildInfo: { packageName },
	};
	const pending = loadSourceModule(
		"src/pages/sponsor/pending.js",
		{
			"lib/config": config,
			"utils/helpers": helpers,
		},
		globals,
	).default;
	const createProcessor = (onSuccess, onError, onSettled) =>
		loadSourceModule(
			"src/pages/sponsor/purchases.js",
			{
				"lib/config": config,
				"./details": recoverDetails,
				"./pending": pending,
			},
			globals,
		).default(onSuccess, onError, onSettled);
	const createReceiver = () => createProcessor(success, error, settled);
	return {
		receive: createReceiver(),
		createReceiver,
		createProcessor,
		pending,
		iap,
		fetch,
		success,
		error,
		settled,
		recoverDetails,
	};
}
