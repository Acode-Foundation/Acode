import assert from "node:assert/strict";
import test from "node:test";
import {
	createRewardStateLifecycle,
	isRewardPassActive,
} from "../../lib/adRewardBannerPolicy.mjs";
import { BANNER_SUPPRESSION_REASON } from "../../lib/bannerVisibilityController.mjs";

function createHarness({
	initialState = { isActive: false, adFreeUntil: 0 },
	statuses = [],
	now = 1_000,
	throwOnEmit = false,
	initialSuppressions = [],
} = {}) {
	let state = initialState;
	let currentTime = now;
	let nextTimerId = 1;
	const timers = new Map();
	const suppressions = new Set(initialSuppressions);
	const events = [];
	const refreshErrors = [];
	const listenerErrors = [];
	const expiryNotices = [];
	const pendingStatuses = [...statuses];

	const lifecycle = createRewardStateLifecycle({
		loadStatus: async () => {
			const status = pendingStatuses.shift();
			if (status instanceof Error) throw status;
			return status;
		},
		normalizeStatus: (status) => {
			const adFreeUntil = Number(status?.adFreeUntil) || 0;
			return {
				isActive: Boolean(status?.isActive && adFreeUntil > currentTime),
				adFreeUntil,
				hasPendingExpiryNotice: Boolean(status?.hasPendingExpiryNotice),
			};
		},
		getCurrentState: () => state,
		setCurrentState: (nextState) => {
			state = nextState;
			events.push(["state", nextState]);
		},
		setBannerSuppressed: (reason, suppressed) => {
			if (suppressed) suppressions.add(reason);
			else suppressions.delete(reason);
			events.push(["suppression", reason, suppressed, state]);
		},
		emitChange: (nextState) => {
			events.push(["emit", nextState]);
			if (throwOnEmit) throw new Error("listener failed");
		},
		onRefreshError: (error) => refreshErrors.push(error),
		onListenerError: (error) => listenerErrors.push(error),
		onExpiryNotice: (nextState) => expiryNotices.push(nextState),
		now: () => currentTime,
		setTimer: (callback, delay) => {
			const timerId = nextTimerId++;
			timers.set(timerId, { callback, delay });
			events.push(["timer", delay]);
			return timerId;
		},
		clearTimer: (timerId) => timers.delete(timerId),
	});

	return {
		events,
		expiryNotices,
		lifecycle,
		listenerErrors,
		refreshErrors,
		suppressions,
		get state() {
			return state;
		},
		get timers() {
			return [...timers.values()];
		},
		setNow(value) {
			currentTime = value;
		},
		runNextTimer() {
			const [timerId, timer] = timers.entries().next().value ?? [];
			assert.ok(timer, "Expected a scheduled expiry timer.");
			timers.delete(timerId);
			timer.callback();
		},
	};
}

test("active startup stores state before suppressing and scheduling", async () => {
	const active = { isActive: true, adFreeUntil: 61_000 };
	const harness = createHarness({ statuses: [active] });

	const result = await harness.lifecycle.initialize();

	assert.equal(result.refreshed, true);
	assert.equal(
		harness.suppressions.has(BANNER_SUPPRESSION_REASON.REWARDED_PASS),
		true,
	);
	assert.deepEqual(
		harness.events.map(([event]) => event),
		["state", "suppression", "emit", "timer"],
	);
	assert.equal(harness.events[1][3], harness.state);
	assert.equal(harness.timers[0].delay, 60_000);
});

test("redemption applies rewarded suppression immediately", () => {
	const harness = createHarness();

	const redeemedState = harness.lifecycle.applyStatus({
		isActive: true,
		adFreeUntil: 31_000,
	});

	assert.equal(redeemedState, harness.state);
	assert.equal(
		harness.suppressions.has(BANNER_SUPPRESSION_REASON.REWARDED_PASS),
		true,
	);
	assert.equal(harness.timers.length, 1);
});

test("expiry timer refresh clears rewarded suppression and notifies", async () => {
	const harness = createHarness({
		statuses: [
			{ isActive: true, adFreeUntil: 2_000 },
			{
				isActive: false,
				adFreeUntil: 2_000,
				hasPendingExpiryNotice: true,
			},
		],
	});
	await harness.lifecycle.initialize();

	harness.setNow(2_000);
	harness.runNextTimer();
	await harness.lifecycle.whenIdle();

	assert.equal(
		harness.suppressions.has(BANNER_SUPPRESSION_REASON.REWARDED_PASS),
		false,
	);
	assert.equal(harness.expiryNotices.length, 1);
	assert.equal(harness.timers.length, 0);
});

test("resume after expiry clears rewarded suppression", async () => {
	const harness = createHarness({
		statuses: [
			{ isActive: true, adFreeUntil: 2_000 },
			{ isActive: false, adFreeUntil: 2_000 },
		],
	});
	await harness.lifecycle.initialize();

	harness.setNow(2_000);
	await harness.lifecycle.resume();

	assert.equal(
		harness.suppressions.has(BANNER_SUPPRESSION_REASON.REWARDED_PASS),
		false,
	);
	assert.equal(harness.timers.length, 0);
});

test("refresh failure preserves state, suppression, and existing timer", async () => {
	const failure = new Error("offline");
	const harness = createHarness({
		statuses: [
			{ isActive: true, adFreeUntil: 61_000 },
			failure,
		],
	});
	await harness.lifecycle.initialize();
	const activeState = harness.state;
	const existingTimer = harness.timers[0];
	const eventCount = harness.events.length;

	const result = await harness.lifecycle.resume();

	assert.deepEqual(result, { state: activeState, refreshed: false });
	assert.equal(harness.state, activeState);
	assert.equal(
		harness.suppressions.has(BANNER_SUPPRESSION_REASON.REWARDED_PASS),
		true,
	);
	assert.equal(harness.timers[0], existingTimer);
	assert.equal(harness.events.length, eventCount);
	assert.deepEqual(harness.refreshErrors, [failure]);
});

test("throwing change listeners cannot prevent expiry scheduling", async () => {
	const harness = createHarness({
		statuses: [{ isActive: true, adFreeUntil: 61_000 }],
		throwOnEmit: true,
	});

	const result = await harness.lifecycle.initialize();

	assert.equal(result.refreshed, true);
	assert.equal(harness.listenerErrors.length, 1);
	assert.equal(harness.timers.length, 1);
	assert.equal(
		harness.suppressions.has(BANNER_SUPPRESSION_REASON.REWARDED_PASS),
		true,
	);
});

test("clearing reward suppression leaves Pro suppression active", () => {
	const harness = createHarness({
		initialSuppressions: [BANNER_SUPPRESSION_REASON.PRO],
	});

	harness.lifecycle.applyStatus({
		isActive: true,
		adFreeUntil: 61_000,
	});
	harness.lifecycle.applyStatus({
		isActive: false,
		adFreeUntil: 0,
	});

	assert.deepEqual(harness.suppressions, new Set([BANNER_SUPPRESSION_REASON.PRO]));
});

test("uses the same expiry predicate exposed to ad eligibility checks", () => {
	const now = 5_000;
	assert.equal(
		isRewardPassActive({ isActive: true, adFreeUntil: now + 1 }, now),
		true,
	);
	assert.equal(
		isRewardPassActive({ isActive: true, adFreeUntil: now }, now),
		false,
	);
	assert.equal(isRewardPassActive(null, now), false);
});
