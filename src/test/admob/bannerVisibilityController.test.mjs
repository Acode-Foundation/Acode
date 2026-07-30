import assert from "node:assert/strict";
import test from "node:test";
import {
	BANNER_SUPPRESSION_REASON,
	BannerVisibilityController,
} from "../../lib/bannerVisibilityController.mjs";

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

test("restores the same registered page when reward suppression ends", async () => {
	const harness = createHarness();
	const page = {};
	harness.setActivePage(page);
	harness.controller.registerPage(page);
	await harness.controller.whenIdle();

	harness.controller.setSuppressed(
		BANNER_SUPPRESSION_REASON.REWARDED_PASS,
		true,
	);
	await harness.controller.whenIdle();
	assert.equal(harness.banner.active, false);

	harness.controller.setSuppressed(
		BANNER_SUPPRESSION_REASON.REWARDED_PASS,
		false,
	);
	await harness.controller.whenIdle();

	assert.equal(harness.banner.active, true);
	assert.deepEqual(harness.calls, ["show", "hide", "show"]);
});

test("page registration cannot clear an active suppression", async () => {
	const harness = createHarness();
	const firstPage = {};
	const secondPage = {};
	harness.setActivePage(firstPage);
	harness.controller.registerPage(firstPage);
	await harness.controller.whenIdle();

	harness.controller.setSuppressed(
		BANNER_SUPPRESSION_REASON.REWARDED_PASS,
		true,
	);
	harness.setActivePage(secondPage);
	harness.controller.registerPage(secondPage);
	harness.controller.setKeyboardVisible(true);
	harness.controller.setKeyboardVisible(false);
	harness.changePage(null);
	harness.changePage(secondPage);
	await harness.controller.whenIdle();

	assert.equal(harness.banner.active, false);
	assert.deepEqual(harness.calls, ["show", "hide"]);
});

test("keeps overlapping suppressions independent of keyboard state", async () => {
	const harness = createHarness();
	const page = {};
	harness.setActivePage(page);
	harness.controller.registerPage(page);
	await harness.controller.whenIdle();

	harness.controller.setKeyboardVisible(true);
	harness.controller.setSuppressed(BANNER_SUPPRESSION_REASON.PRO, true);
	harness.controller.setSuppressed(
		BANNER_SUPPRESSION_REASON.REWARDED_PASS,
		true,
	);
	harness.controller.setSuppressed(
		BANNER_SUPPRESSION_REASON.REWARDED_PASS,
		false,
	);
	harness.controller.setKeyboardVisible(false);
	await harness.controller.whenIdle();
	assert.equal(harness.banner.active, false);

	harness.controller.setSuppressed(BANNER_SUPPRESSION_REASON.PRO, false);
	await harness.controller.whenIdle();

	assert.equal(harness.banner.active, true);
	assert.deepEqual(harness.calls, ["show", "hide", "show"]);
});

test("rejects empty suppression reasons", () => {
	const harness = createHarness();
	assert.throws(
		() => harness.controller.setSuppressed(" ", true),
		/Banner suppression reason/,
	);
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
