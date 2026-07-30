import assert from "node:assert/strict";
import test from "node:test";
import {
	PRIVACY_CHOICES_KEY,
	bindPrivacyChoices,
} from "../../lib/privacyChoicesController.mjs";

function createHarness() {
	let listener;
	let closeCallback;
	let unsubscribeCalls = 0;
	const visibility = [];
	const page = {
		setItemVisibility(key, visible) {
			visibility.push({ key, visible });
			return true;
		},
		onClose(callback) {
			closeCallback = callback;
			return () => {
				closeCallback = undefined;
			};
		},
	};

	const dispose = bindPrivacyChoices({
		page,
		subscribe(callback) {
			listener = callback;
			callback({ privacyOptionsRequired: false });
			return () => {
				unsubscribeCalls++;
				listener = undefined;
			};
		},
	});

	return {
		dispose,
		emit(state) {
			listener?.(state);
		},
		close() {
			closeCallback?.();
		},
		get unsubscribeCalls() {
			return unsubscribeCalls;
		},
		visibility,
	};
}

test("reacts to privacy requirement changes without rebuilding settings", () => {
	const harness = createHarness();

	harness.emit({ privacyOptionsRequired: true });
	harness.emit({ privacyOptionsRequired: false });

	assert.deepEqual(harness.visibility, [
		{ key: PRIVACY_CHOICES_KEY, visible: false },
		{ key: PRIVACY_CHOICES_KEY, visible: true },
		{ key: PRIVACY_CHOICES_KEY, visible: false },
	]);
});

test("unsubscribes when the settings page closes", () => {
	const harness = createHarness();
	harness.close();
	harness.emit({ privacyOptionsRequired: true });
	harness.dispose();

	assert.equal(harness.unsubscribeCalls, 1);
	assert.deepEqual(harness.visibility, [
		{ key: PRIVACY_CHOICES_KEY, visible: false },
	]);
});
