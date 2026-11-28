import { createRequire } from "node:module";
import tag from "html-tag-js";
import Ref from "html-tag-js/ref";
import { vi } from "vitest";
import { loadSourceModule } from "./loadSourceModule";

createRequire(import.meta.url)("html-tag-js/polyfill");

export default function setup(available = true, isIOS = true) {
	const loader = {
		showTitleLoader: vi.fn(() => document.body.classList.add("loading")),
		removeTitleLoader: vi.fn(() => document.body.classList.remove("loading")),
	};
	const helpers = {
		isIapAvailable: () => available,
		error: vi.fn(),
		parseJSON: JSON.parse,
	};
	const prompt = vi.fn(async () => ({ name: "Sponsor" }));
	const recover = vi.fn(async () => new Set());
	const iap = {
		USER_CANCELED: 1,
		addPurchaseUpdatedListener: vi.fn(() => vi.fn()),
		setPurchaseUpdatedListener: vi.fn(),
		getPurchases: vi.fn((success) => success([])),
		getProducts: vi.fn((ids, success) =>
			success([
				{
					productId: "gold",
					title: "Gold",
					price: "$10",
					description: "Sponsor",
				},
			]),
		),
		purchase: vi.fn(),
	};
	const globals = {
		tag,
		app: document.body,
		localStorage,
		document,
		Blob,
		FileReader,
		AbortController,
		strings: {
			sponsor: "Sponsor",
			"product not available": "product not available",
		},
		fetch: vi.fn(async () => ({ ok: true, json: async () => [] })),
		...(available ? { iap } : {}),
	};
	const shared = {
		"./style.scss": {},
		"components/page": () => {
			const page = document.createElement("section");
			Object.defineProperty(page, "body", {
				set: (body) => page.replaceChildren(body),
			});
			page.hide = () => {
				page.onhide?.();
				page.remove();
			};
			return page;
		},
		"lib/actionStack": { push: vi.fn(), remove: vi.fn(), pop: vi.fn() },
		"lib/config": { SKU_LIST: ["gold"], API_BASE: "https://example.test/api" },
		"utils/helpers": helpers,
	};
	const details = loadSourceModule(
		"src/pages/sponsor/details.js",
		{
			"lib/platform": { isIOS },
			"dialogs/multiPrompt": prompt,
			"utils/helpers": helpers,
		},
		globals,
	).default;
	const Sponsor = loadSourceModule(
		"src/pages/sponsor/sponsor.js",
		{
			...shared,
			"components/logo": () => document.createElement("span"),
			"dialogs/loader": loader,
			"./details": details,
			"./recovery": {
				__esModule: true,
				default: async () => {
					await new Promise((resolve) => iap.getPurchases(resolve));
				},
				recoverSponsorPurchases: recover,
				subscribeSponsorPurchases: () => vi.fn(),
			},
		},
		globals,
	).default;
	const Sponsors = loadSourceModule(
		"src/pages/sponsors/sponsors.js",
		{
			...shared,
			"components/toast": vi.fn(),
			"html-tag-js/ref": Ref,
			"pages/sponsor": Sponsor,
		},
		globals,
	).default;
	return {
		Sponsor,
		Sponsors,
		helpers,
		loader,
		prompt,
		iap,
		details,
		recover,
	};
}
