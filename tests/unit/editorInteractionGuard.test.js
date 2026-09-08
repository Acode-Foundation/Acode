import assert from "node:assert/strict";
import { test } from "vitest";
import { createEditorInteractionGuard } from "../../src/lib/editorInteractionGuard";

function createEvent(matchesGuardedTarget, cancelable = true) {
	let defaultPrevented = false;
	let propagationStopped = false;

	return {
		cancelable,
		target: {
			closest() {
				return matchesGuardedTarget ? {} : null;
			},
		},
		preventDefault() {
			defaultPrevented = true;
		},
		stopImmediatePropagation() {
			propagationStopped = true;
		},
		get defaultPrevented() {
			return defaultPrevented;
		},
		get propagationStopped() {
			return propagationStopped;
		},
	};
}

test("suppresses guarded controls briefly after an editor interaction", () => {
	let time = 100;
	const guard = createEditorInteractionGuard({ now: () => time });
	guard.markActive();
	const event = createEvent(true);

	assert.equal(guard.suppress(event), true);
	assert.equal(event.defaultPrevented, true);
	assert.equal(event.propagationStopped, true);

	time = 300;
	assert.equal(guard.suppress(createEvent(true)), false);
});

test("does not suppress editor or unrelated events", () => {
	const guard = createEditorInteractionGuard({ now: () => 100 });
	guard.markActive();
	const event = createEvent(false);

	assert.equal(guard.suppress(event), false);
	assert.equal(event.defaultPrevented, false);
	assert.equal(event.propagationStopped, false);
});

test("stops non-cancelable guarded events without calling preventDefault", () => {
	const guard = createEditorInteractionGuard({ now: () => 100 });
	guard.markActive();
	const event = createEvent(true, false);

	assert.equal(guard.suppress(event), true);
	assert.equal(event.defaultPrevented, false);
	assert.equal(event.propagationStopped, true);
});
