// @vitest-environment happy-dom
import tag from "html-tag-js";
import Ref from "html-tag-js/ref";
import { afterEach, expect, it, vi } from "vitest";
import { loadSourceModule } from "../helpers/loadSourceModule";

afterEach(() => document.body.replaceChildren());

it("hides unfulfillable iOS plugin purchases without offering Google Play billing", async () => {
	const fixture = setup("ios");
	const view = await fixture.plugin({ isPaid: true, price: "$2" });
	expect(view.querySelector('[data-type="buy"]')).toBeNull();
	expect(view.textContent).toContain("product not available");
	expect(view.textContent).not.toContain("iap-plugin-purchase-warning");
	expect(fixture.platform.pluginPurchases).toBe(false);
	expect(fixture.platform.sponsorPurchases).toBe(false);
});

it.each([
	{ isPaid: false },
	{ isPaid: true, purchased: true },
])("keeps free and account-owned plugins installable on iOS: %j", async (props) => {
	const fixture = setup("ios");
	const install = vi.fn();
	const view = await fixture.plugin({ ...props, install });
	view.querySelector('[data-type="install"]').click();
	expect(install).toHaveBeenCalledOnce();
	expect(view.textContent).not.toContain("refund");
});

it("keeps installed plugin updates and removal available on iOS", async () => {
	const fixture = setup("ios");
	const install = vi.fn();
	const uninstall = vi.fn();
	const view = await fixture.plugin({
		isPaid: true,
		installed: true,
		update: true,
		install,
		uninstall,
	});
	view.querySelector('[data-type="update"]').click();
	view.querySelector('[data-type="uninstall"]').click();
	expect(install).toHaveBeenCalledOnce();
	expect(uninstall).toHaveBeenCalledOnce();
});

it("retains Android purchase and refund actions", async () => {
	const fixture = setup("android");
	const buy = vi.fn();
	const refund = vi.fn();
	const purchaseView = await fixture.plugin({ isPaid: true, price: "$2", buy });
	purchaseView.querySelector('[data-type="buy"]').click();
	expect(buy).toHaveBeenCalledOnce();
	const ownedView = await fixture.plugin({
		isPaid: true,
		purchased: true,
		price: "$2",
		refund,
	});
	ownedView.querySelector(".more-info-small .link").click();
	expect(refund).toHaveBeenCalledOnce();
	expect(fixture.platform.sponsorPurchases).toBe(true);
});

it.each([
	"ios",
	"android",
])("blocks incompatible plugins with a platform-appropriate version notice on %s", async (platformId) => {
	const fixture = setup(platformId);
	const view = await fixture.plugin({ minVersionCode: 2000 });
	const notice = view.querySelector(".action-buttons .error");
	expect(notice.textContent).toContain("Fixture");
	expect(notice.textContent).toContain("2000");
	expect(view.querySelector(".action-buttons button")).toBeNull();
	if (platformId === "ios") {
		expect(notice.querySelector("a")).toBeNull();
		expect(notice.textContent).not.toContain("Click here");
	} else {
		expect(notice.querySelector("a").href).toContain("play.google.com");
	}
});

it("blocks direct iOS sponsorship entry before querying products or registering a purchase listener", () => {
	const fixture = setup("ios");
	const page = vi.fn();
	const iap = {
		getProducts: vi.fn(),
		setPurchaseUpdatedListener: vi.fn(),
		purchase: vi.fn(),
	};
	const Sponsor = loadSourceModule(
		"src/pages/sponsor/sponsor.js",
		{
			"./style.scss": {},
			fileSystem: {},
			"components/logo": {},
			"components/page": page,
			"dialogs/alert": fixture.alert,
			"dialogs/dialog": {},
			"dialogs/loader": {},
			"dialogs/multiPrompt": {},
			"lib/actionStack": {},
			"lib/config": {},
			"lib/platform": fixture.platform,
			"utils/helpers": {},
		},
		{ ...fixture.globals, iap },
	).default;
	Sponsor();
	expect(page).not.toHaveBeenCalled();
	expect(iap.getProducts).not.toHaveBeenCalled();
	expect(iap.setPurchaseUpdatedListener).not.toHaveBeenCalled();
	expect(iap.purchase).not.toHaveBeenCalled();
	expect(fixture.alert).toHaveBeenCalledWith("info", "product not available");
});

function setup(platformId) {
	const platform = loadSourceModule(
		"src/lib/platform.js",
		{},
		{ Bridge: { platformId } },
	).default;
	const alert = vi.fn();
	const globals = {
		tag: (...args) => tag(...args.map(normalize)),
		document,
		window,
		BuildInfo: { versionCode: 1011 },
		strings: new Proxy(
			{
				"plugin min version": "{name} requires {v-code}. Click here to update.",
				"plugin min version required":
					"{name} requires Acode build {v-code} or later.",
			},
			{ get: (target, key) => target[key] ?? key },
		),
	};
	const dayjs = Object.assign(vi.fn(), {
		extend: vi.fn(),
		updateLocale: vi.fn(),
	});
	const view = loadSourceModule(
		"src/pages/plugin/plugin.view.js",
		{
			fileSystem: {},
			"components/tabView": () => document.createElement("div"),
			"components/toast": vi.fn(),
			"dayjs/esm": dayjs,
			"dayjs/esm/plugin/relativeTime": {},
			"dayjs/esm/plugin/updateLocale": {},
			"dayjs/esm/plugin/utc": {},
			"dialogs/alert": alert,
			"dialogs/confirm": {},
			dompurify: { sanitize: (value) => value || "" },
			"html-tag-js/ref": Ref,
			"lib/actionStack": {},
			"lib/auth": { getLoggedInUser: async () => null },
			"lib/config": {
				PLAY_STORE_URL:
					"https://play.google.com/store/apps/details?id=com.foxdebug.acode",
			},
			"lib/lang": {},
			"lib/platform": platform,
			"lib/settings": {},
			"utils/helpers": { shouldAllowExternalPurchase: () => false },
			"utils/Url": { join: (...parts) => parts.join("/") },
			"./reviewUtils": {
				getRatingLabel: () => "unrated",
				getRatingClass: () => "unrated",
			},
		},
		globals,
	).default;
	return {
		platform,
		alert,
		globals,
		async plugin(props) {
			const element = view({
				id: "fixture",
				name: "Fixture",
				body: "",
				version: "1.0.0",
				...props,
			});
			document.body.append(element);
			await vi.waitFor(() =>
				expect(
					element.querySelector(".action-buttons")?.textContent.trim(),
				).not.toBe(""),
			);
			return element;
		},
	};
}

function normalize(value) {
	if (Array.isArray(value)) return value.map(normalize);
	// html-tag-js checks instanceof Promise; async functions run in the source VM.
	if (typeof value?.then === "function") return Promise.resolve(value);
	return value;
}
