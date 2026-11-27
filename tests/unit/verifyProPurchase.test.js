import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadSourceModule } from "../helpers/loadSourceModule";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/**
 * @param {{hasPro: boolean, cached?: boolean}} start
 */
function setup({ hasPro, cached = false }) {
	let answer;
	const storage = new Map(cached ? [["acode_pro", "true"]] : []);
	const config = { HAS_PRO: hasPro };
	const setBannerSuppressed = vi.fn();
	const { default: verifyProPurchase, PRO_CHECK_TIMEOUT_MS } = loadSourceModule(
		"src/lib/verifyProPurchase.js",
		{
			"utils/helpers": {
				__esModule: true,
				default: {
					promisify: (fn) => new Promise((resolve) => fn(resolve)),
				},
			},
			"./config": { __esModule: true, default: config },
			"./platform": { __esModule: true, default: { isIOS: false } },
			"./startAd": {
				BANNER_SUPPRESSION_REASON: { PRO: "pro" },
				setBannerSuppressed,
			},
		},
		{
			setTimeout,
			clearTimeout,
			navigator: { onLine: true },
			localStorage: {
				getItem: (key) => storage.get(key) ?? null,
				setItem: (key, value) => storage.set(key, value),
				removeItem: (key) => storage.delete(key),
			},
			iap: {
				PURCHASE_STATE_PURCHASED: 1,
				startConnection: (resolve) => resolve(),
				// The store answers whenever the test decides.
				getPurchases: (resolve) => {
					answer = resolve;
				},
			},
		},
	);
	const logger = { log: vi.fn() };
	return {
		config,
		storage,
		setBannerSuppressed,
		check: verifyProPurchase(true, logger),
		answer: async (owned) => {
			while (!answer) await Promise.resolve();
			answer(
				owned ? [{ purchaseState: 1, productIds: ["acode_pro_new"] }] : [],
			);
			await vi.advanceTimersByTimeAsync(0);
		},
		timeOut: () => vi.advanceTimersByTimeAsync(PRO_CHECK_TIMEOUT_MS),
	};
}

it("applies a purchase that arrives after the timeout, including hiding ads", async () => {
	const f = setup({ hasPro: false });
	await f.timeOut();
	await f.check;
	expect(f.config.HAS_PRO).toBe(false);

	await f.answer(true);
	expect(f.config.HAS_PRO).toBe(true);
	expect(f.setBannerSuppressed).toHaveBeenCalledWith("pro", true);
	expect(f.storage.get("acode_pro")).toBe("true");
});

it("clears a revoked cached purchase even when the result is late", async () => {
	const f = setup({ hasPro: true, cached: true });
	await f.timeOut();
	await f.answer(false);

	// Too late to change this session, but the next offline launch is not Pro.
	expect(f.config.HAS_PRO).toBe(true);
	expect(f.storage.has("acode_pro")).toBe(false);
});

it("downgrades a revoked cached purchase when the result is in time", async () => {
	const f = setup({ hasPro: true, cached: true });
	await f.answer(false);
	await f.check;
	expect(f.config.HAS_PRO).toBe(false);
	expect(f.storage.has("acode_pro")).toBe(false);
});

it("keeps Pro and its cache when a purchase or login upgraded the session meanwhile", async () => {
	const f = setup({ hasPro: false });
	f.config.HAS_PRO = true;
	f.storage.set("acode_pro", "true");
	await f.answer(false);
	await f.check;
	expect(f.config.HAS_PRO).toBe(true);
	expect(f.storage.get("acode_pro")).toBe("true");
});
