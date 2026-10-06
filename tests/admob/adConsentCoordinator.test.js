import assert from "node:assert/strict";
import { test } from "vitest";
import {
	AdConsentCoordinator,
	EMPTY_PRIVACY_STATE,
} from "../../src/lib/adConsentCoordinator.mjs";

function createHarness({
	gatherState,
	previousState = EMPTY_PRIVACY_STATE,
	gatherError,
	showOptions,
}) {
	let gatherCalls = 0;
	let getStateCalls = 0;
	let initializeCalls = 0;
	const errors = [];
	const privacy = {
		async gatherConsent() {
			gatherCalls++;
			if (gatherError) throw gatherError;
			return gatherState;
		},
		async getState() {
			getStateCalls++;
			return previousState;
		},
		async showOptions() {
			if (showOptions) return showOptions();
			return gatherState;
		},
	};
	const coordinator = new AdConsentCoordinator({
		privacy,
		initializeAds: async () => {
			initializeCalls++;
		},
		onError: (error) => errors.push(error),
	});

	return {
		coordinator,
		privacy,
		errors,
		get gatherCalls() {
			return gatherCalls;
		},
		get getStateCalls() {
			return getStateCalls;
		},
		get initializeCalls() {
			return initializeCalls;
		},
	};
}

test("starts ads after required consent is resolved", async () => {
	const harness = createHarness({
		gatherState: {
			consentStatus: "obtained",
			canRequestAds: true,
			privacyOptionsRequired: true,
		},
	});

	assert.deepEqual(await harness.coordinator.start(), {
		consentStatus: "obtained",
		canRequestAds: true,
		privacyOptionsRequired: true,
	});
	assert.equal(harness.gatherCalls, 1);
	assert.equal(harness.initializeCalls, 1);
});

test("starts ads immediately when consent is not required", async () => {
	const harness = createHarness({
		gatherState: {
			consentStatus: "notRequired",
			canRequestAds: true,
			privacyOptionsRequired: false,
		},
	});

	await harness.coordinator.start();
	assert.equal(harness.initializeCalls, 1);
});

test("serves limited ads after a user records a non-consent choice", async () => {
	const harness = createHarness({
		gatherState: {
			consentStatus: "obtained",
			canRequestAds: true,
			privacyOptionsRequired: true,
		},
	});

	await harness.coordinator.start();
	assert.equal(harness.initializeCalls, 1);
});

test("uses valid previous-session consent after an update failure", async () => {
	const updateError = new Error("offline");
	const harness = createHarness({
		gatherError: updateError,
		previousState: {
			consentStatus: "obtained",
			canRequestAds: true,
			privacyOptionsRequired: true,
		},
	});

	await harness.coordinator.start();
	assert.equal(harness.getStateCalls, 1);
	assert.equal(harness.initializeCalls, 1);
	assert.deepEqual(harness.errors, [updateError]);
});

test("does not request ads when update and cached consent are unavailable", async () => {
	const harness = createHarness({
		gatherError: new Error("offline"),
		previousState: EMPTY_PRIVACY_STATE,
	});

	await harness.coordinator.start();
	assert.equal(harness.initializeCalls, 0);
});

test("deduplicates consent collection and ad initialization", async () => {
	const harness = createHarness({
		gatherState: {
			consentStatus: "notRequired",
			canRequestAds: true,
			privacyOptionsRequired: false,
		},
	});

	await Promise.all([
		harness.coordinator.start(),
		harness.coordinator.start(),
		harness.coordinator.start(),
	]);
	assert.equal(harness.gatherCalls, 1);
	assert.equal(harness.initializeCalls, 1);
});

test("hides a stale privacy-option entry and keeps ads single-started", async () => {
	const harness = createHarness({
		gatherState: {
			consentStatus: "obtained",
			canRequestAds: true,
			privacyOptionsRequired: true,
		},
	});
	const states = [];
	const unsubscribe = harness.coordinator.subscribe((state) => states.push(state));

	await harness.coordinator.start();
	harness.privacy.showOptions = async () => ({
		consentStatus: "notRequired",
		canRequestAds: true,
		privacyOptionsRequired: false,
	});
	await harness.coordinator.showPrivacyOptions();
	unsubscribe();

	assert.equal(harness.initializeCalls, 1);
	assert.equal(states.at(-1).privacyOptionsRequired, false);
});

test("normalizes an invalid native state instead of starting ads", async () => {
	const harness = createHarness({
		gatherState: {
			consentStatus: "unexpected",
			canRequestAds: "yes",
			privacyOptionsRequired: 1,
		},
	});

	assert.deepEqual(await harness.coordinator.start(), EMPTY_PRIVACY_STATE);
	assert.equal(harness.initializeCalls, 0);
});

test("deduplicates concurrent privacy-option requests", async () => {
	let resolveOptions;
	let showOptionsCalls = 0;
	const optionsResult = new Promise((resolve) => {
		resolveOptions = resolve;
	});
	const harness = createHarness({
		gatherState: {
			consentStatus: "obtained",
			canRequestAds: true,
			privacyOptionsRequired: true,
		},
		showOptions() {
			showOptionsCalls++;
			return optionsResult;
		},
	});
	await harness.coordinator.start();

	const firstRequest = harness.coordinator.showPrivacyOptions();
	const secondRequest = harness.coordinator.showPrivacyOptions();
	assert.equal(firstRequest, secondRequest);
	resolveOptions({
		consentStatus: "obtained",
		canRequestAds: true,
		privacyOptionsRequired: false,
	});

	assert.deepEqual(await firstRequest, {
		consentStatus: "obtained",
		canRequestAds: true,
		privacyOptionsRequired: false,
	});
	assert.equal(showOptionsCalls, 1);
});

test("preserves consent state when privacy options reject", async () => {
	const gatherState = {
		consentStatus: "obtained",
		canRequestAds: true,
		privacyOptionsRequired: true,
	};
	const optionsError = new Error("native failure");
	const harness = createHarness({
		gatherState,
		showOptions: async () => {
			throw optionsError;
		},
	});
	await harness.coordinator.start();

	await assert.rejects(
		harness.coordinator.showPrivacyOptions(),
		(error) => error === optionsError,
	);
	assert.deepEqual(harness.coordinator.state, gatherState);
	assert.equal(harness.initializeCalls, 1);
});
