import assert from "node:assert/strict";
import test from "node:test";
import { BannerVisibilityController } from "../../lib/bannerVisibilityController.mjs";

function createHarness() {
	let activePage = null;
	let notifyPageChange = () => {};
	const calls = [];
	const banner = {
		active: false,
		async show() {
			calls.push("show");
		},
		async hide() {
			calls.push("hide");
		},
	};
	const controller = new BannerVisibilityController({
		getActivePage: () => activePage,
		observePageChanges(callback) {
			notifyPageChange = callback;
			return () => {
				notifyPageChange = () => {};
			};
		},
		onError(error) {
			throw error;
		},
	});
	controller.setBanner(banner);

	return {
		banner,
		calls,
		controller,
		changePage(page) {
			activePage = page;
			notifyPageChange();
		},
		setActivePage(page) {
			activePage = page;
		},
	};
}

test("shows only for a registered active page and ignores repeated syncs", async () => {
	const harness = createHarness();
	const page = {};
	harness.setActivePage(page);

	harness.controller.registerPage(page);
	harness.controller.reconcile();
	await harness.controller.whenIdle();

	assert.equal(harness.banner.active, true);
	assert.deepEqual(harness.calls, ["show"]);
});

test("hides in the editor and restores for an underlying registered page", async () => {
	const harness = createHarness();
	const adPage = {};
	const plainPage = {};
	harness.setActivePage(adPage);
	harness.controller.registerPage(adPage);
	await harness.controller.whenIdle();

	harness.changePage(plainPage);
	await harness.controller.whenIdle();
	assert.equal(harness.banner.active, false);

	harness.changePage(adPage);
	await harness.controller.whenIdle();
	assert.equal(harness.banner.active, true);

	harness.changePage(null);
	await harness.controller.whenIdle();
	assert.equal(harness.banner.active, false);
	assert.deepEqual(harness.calls, ["show", "hide", "show", "hide"]);
});

test("keeps nested ad pages visible without redundant native operations", async () => {
	const harness = createHarness();
	const parentPage = {};
	const childPage = {};
	harness.setActivePage(parentPage);
	harness.controller.registerPage(parentPage);
	await harness.controller.whenIdle();

	harness.setActivePage(childPage);
	harness.controller.registerPage(childPage);
	await harness.controller.whenIdle();
	harness.changePage(parentPage);
	await harness.controller.whenIdle();

	assert.equal(harness.banner.active, true);
	assert.deepEqual(harness.calls, ["show"]);
});

test("temporarily suppresses the banner while the keyboard is visible", async () => {
	const harness = createHarness();
	const page = {};
	harness.setActivePage(page);
	harness.controller.registerPage(page);
	await harness.controller.whenIdle();

	harness.controller.setKeyboardVisible(true);
	await harness.controller.whenIdle();
	assert.equal(harness.banner.active, true);

	harness.controller.setKeyboardVisible(false);
	await harness.controller.whenIdle();
	assert.deepEqual(harness.calls, ["show", "hide", "show"]);
});

test("forced suspension survives page and keyboard changes", async () => {
	const harness = createHarness();
	const page = {};
	harness.setActivePage(page);
	harness.controller.registerPage(page);
	await harness.controller.whenIdle();

	harness.controller.suspend();
	harness.controller.setKeyboardVisible(true);
	harness.controller.setKeyboardVisible(false);
	harness.changePage(null);
	harness.changePage(page);
	await harness.controller.whenIdle();

	assert.equal(harness.banner.active, false);
	assert.deepEqual(harness.calls, ["show", "hide"]);
});

test("serializes an in-flight show before the latest hide request", async () => {
	let finishShow;
	const page = {};
	let activePage = page;
	const calls = [];
	const banner = {
		active: false,
		show() {
			calls.push("show");
			return new Promise((resolve) => {
				finishShow = resolve;
			});
		},
		async hide() {
			calls.push("hide");
		},
	};
	const controller = new BannerVisibilityController({
		getActivePage: () => activePage,
		onError(error) {
			throw error;
		},
	});
	controller.setBanner(banner);
	controller.registerPage(page);
	await new Promise((resolve) => setImmediate(resolve));

	activePage = null;
	controller.reconcile();
	finishShow();
	await controller.whenIdle();

	assert.equal(banner.active, false);
	assert.deepEqual(calls, ["show", "hide"]);
});
