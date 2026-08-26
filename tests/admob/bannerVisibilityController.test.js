import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import {
	BANNER_SUPPRESSION_REASON,
	BannerVisibilityController,
} from "../../src/lib/bannerVisibilityController.mjs";

function createHarness({ show, hide } = {}) {
	let activePage = null;
	let notifyPageChange = () => {};
	const calls = [];
	const errors = [];
	const listeners = new Map();
	const banner = {
		active: false,
		async show() {
			calls.push("show");
			return show?.();
		},
		async hide() {
			calls.push("hide");
			return hide?.();
		},
		on(eventName, listener) {
			let eventListeners = listeners.get(eventName);
			if (!eventListeners) {
				eventListeners = new Set();
				listeners.set(eventName, eventListeners);
			}
			eventListeners.add(listener);
			return () => eventListeners.delete(listener);
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
			errors.push(error);
		},
	});
	controller.setBanner(banner);

	return {
		banner,
		calls,
		controller,
		emit(eventName, event = {}) {
			for (const listener of listeners.get(eventName) ?? []) listener(event);
		},
		errors,
		changePage(page) {
			activePage = page;
			notifyPageChange();
		},
		setActivePage(page) {
			activePage = page;
		},
	};
}

async function createEligibleHarness(options) {
	const harness = createHarness(options);
	const page = {};
	harness.setActivePage(page);
	harness.controller.registerPage(page);
	await harness.controller.whenIdle();
	return { harness, page };
}

afterEach(() => {
	vi.useRealTimers();
});

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

test("retries one transient failure after 500ms and caps requests at two", async () => {
	vi.useFakeTimers();
	const { harness } = await createEligibleHarness();

	harness.emit("loadfail", { code: 3 });
	harness.emit("loadfail", { code: 3 });
	await vi.advanceTimersByTimeAsync(499);
	assert.deepEqual(harness.calls, ["show"]);
	await vi.advanceTimersByTimeAsync(1);
	await harness.controller.whenIdle();

	harness.emit("loadfail", { code: 3 });
	harness.controller.reconcile();
	await vi.advanceTimersByTimeAsync(500);
	await harness.controller.whenIdle();

	assert.deepEqual(harness.calls, ["show", "show"]);
	assert.equal(harness.errors.length, 3);
});

test("successful load restores the retry allowance", async () => {
	vi.useFakeTimers();
	const { harness } = await createEligibleHarness();

	harness.emit("loadfail", { code: 3 });
	await vi.advanceTimersByTimeAsync(500);
	await harness.controller.whenIdle();
	harness.emit("load");
	harness.emit("loadfail", { code: 3 });
	await vi.advanceTimersByTimeAsync(500);
	await harness.controller.whenIdle();

	assert.deepEqual(harness.calls, ["show", "show", "show"]);
});

test("cancels a retry on navigation and restores it when the page returns", async () => {
	vi.useFakeTimers();
	const { harness, page } = await createEligibleHarness();

	harness.emit("loadfail", { code: 3 });
	harness.changePage({});
	await harness.controller.whenIdle();
	await vi.advanceTimersByTimeAsync(500);
	assert.deepEqual(harness.calls, ["show"]);

	harness.changePage(page);
	await harness.controller.whenIdle();
	harness.emit("loadfail", { code: 3 });
	await vi.advanceTimersByTimeAsync(500);
	await harness.controller.whenIdle();

	assert.deepEqual(harness.calls, ["show", "show", "show"]);
});

test("does not retry non-transient load failures", async () => {
	vi.useFakeTimers();
	const { harness } = await createEligibleHarness();

	harness.emit("loadfail", { code: 1 });
	harness.controller.reconcile();
	await vi.advanceTimersByTimeAsync(500);
	await harness.controller.whenIdle();

	assert.deepEqual(harness.calls, ["show"]);
});

test("retries a rejected native show call", async () => {
	vi.useFakeTimers();
	let showCalls = 0;
	const { harness } = await createEligibleHarness({
		show() {
			showCalls++;
			if (showCalls === 1) throw new Error("bridge failure");
		},
	});

	await vi.advanceTimersByTimeAsync(500);
	await harness.controller.whenIdle();

	assert.deepEqual(harness.calls, ["show", "show"]);
	assert.equal(harness.errors.length, 1);
});

test("keeps a rejected hide operation eligible for reconciliation", async () => {
	let hideCalls = 0;
	const { harness } = await createEligibleHarness({
		hide() {
			hideCalls++;
			if (hideCalls === 1) throw new Error("bridge failure");
		},
	});

	harness.controller.setKeyboardVisible(true);
	await harness.controller.whenIdle();
	harness.controller.reconcile();
	await harness.controller.whenIdle();

	assert.deepEqual(harness.calls, ["show", "hide", "hide"]);
	assert.equal(harness.errors.length, 1);
});

test("replacement and disposal cancel retries and detach listeners", async () => {
	vi.useFakeTimers();
	const { harness } = await createEligibleHarness();
	harness.emit("loadfail", { code: 3 });

	const replacementCalls = [];
	const replacementListeners = new Map();
	harness.controller.setBanner({
		active: false,
		async hide() {
			replacementCalls.push("hide");
		},
		on(eventName, listener) {
			replacementListeners.set(eventName, listener);
			return () => replacementListeners.delete(eventName);
		},
		async show() {
			replacementCalls.push("show");
		},
	});
	await harness.controller.whenIdle();
	const errorsBeforeStaleEvent = harness.errors.length;
	harness.emit("loadfail", { code: 3 });
	replacementListeners.get("loadfail")({ code: 3 });
	harness.controller.dispose();
	replacementListeners.get("loadfail")?.({ code: 3 });
	await vi.advanceTimersByTimeAsync(500);

	assert.deepEqual(replacementCalls, ["show"]);
	assert.equal(harness.errors.length, errorsBeforeStaleEvent + 1);
});

test("ignores a stale show rejection after replacing the banner", async () => {
	let rejectOldShow;
	const harness = createHarness({
		show: () =>
			new Promise((_, reject) => {
				rejectOldShow = reject;
			}),
	});
	const page = {};
	harness.setActivePage(page);
	harness.controller.registerPage(page);
	await new Promise((resolve) => setImmediate(resolve));

	const replacementCalls = [];
	harness.controller.setBanner({
		active: false,
		async hide() {
			replacementCalls.push("hide");
		},
		on() {
			return () => {};
		},
		async show() {
			replacementCalls.push("show");
		},
	});
	rejectOldShow(new Error("stale bridge failure"));
	await harness.controller.whenIdle();

	assert.deepEqual(replacementCalls, ["show"]);
	assert.deepEqual(harness.errors, []);
});
