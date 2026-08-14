import { describe, expect, it } from "vitest";
import {
	captureReadOnlyQuickToolsKey,
	createReadOnlyQuickToolsCaptureSession,
} from "handlers/readOnlyQuickToolsCapture";

const modifiers = {
	shiftKey: false,
	altKey: false,
	ctrlKey: true,
	metaKey: false,
};

function readOnlyTarget() {
	return { state: { readOnly: true } };
}

describe("read-only QuickTools capture", () => {
	it("declines editable targets", () => {
		expect(
			createReadOnlyQuickToolsCaptureSession(
				{ state: { readOnly: false } },
				modifiers,
			),
		).toBeNull();
	});

	it.each([
		["keydown", { key: "a" }],
		["beforeinput", { data: "a", inputType: "insertText" }],
		["input", { data: "a", inputType: "insertText" }],
		["compositionend", { data: "a" }],
	])("captures one key from %s", (type, event) => {
		const session = createReadOnlyQuickToolsCaptureSession(
			readOnlyTarget(),
			modifiers,
		);
		expect(session).not.toBeNull();

		if (session) {
			const result = captureReadOnlyQuickToolsKey(session, {
				type: type as "keydown" | "beforeinput" | "input" | "compositionend",
				...event,
			});
			expect(result.outcome).toEqual({ kind: "key", key: "a" });
			expect(result.session.consumed).toBe(true);
		}
	});

	it("prefers event data over a stale textarea value", () => {
		const session = createReadOnlyQuickToolsCaptureSession(
			readOnlyTarget(),
			modifiers,
		);
		expect(session).not.toBeNull();

		if (session) {
			const result = captureReadOnlyQuickToolsKey(session, {
				type: "input",
				data: "a",
				value: "stale-a",
			});
			expect(result.outcome).toEqual({ kind: "key", key: "a" });
		}
	});

	it("uses the textarea only when event data is unavailable", () => {
		const session = createReadOnlyQuickToolsCaptureSession(
			readOnlyTarget(),
			modifiers,
		);
		expect(session).not.toBeNull();

		if (session) {
			const result = captureReadOnlyQuickToolsKey(session, {
				type: "input",
				data: null,
				value: "a",
			});
			expect(result.outcome).toEqual({ kind: "key", key: "a" });
		}
	});

	it.each([
		{ type: "input", data: "", value: "a" },
		{ type: "input", data: "aa", value: "a" },
		{ type: "input", data: null, value: "aa" },
		{
			type: "beforeinput",
			data: null,
			value: "a",
			inputType: "deleteContentBackward",
		},
	])("keeps ambiguous or deletion-only input armed", (event) => {
		const session = createReadOnlyQuickToolsCaptureSession(
			readOnlyTarget(),
			modifiers,
		);
		expect(session).not.toBeNull();

		if (session) {
			const result = captureReadOnlyQuickToolsKey(session, {
				...event,
				type: event.type as "beforeinput" | "input",
			});
			expect(result.outcome).toEqual({ kind: "pending" });
			expect(result.session.consumed).toBe(false);
		}
	});

	it("accepts a valid key after an ambiguous event", () => {
		const session = createReadOnlyQuickToolsCaptureSession(
			readOnlyTarget(),
			modifiers,
		);
		expect(session).not.toBeNull();

		if (session) {
			const ambiguous = captureReadOnlyQuickToolsKey(session, {
				type: "input",
				data: null,
				value: "aa",
			});
			expect(ambiguous.outcome).toEqual({ kind: "pending" });

			const valid = captureReadOnlyQuickToolsKey(ambiguous.session, {
				type: "input",
				data: "a",
				value: "a",
			});
			expect(valid.outcome).toEqual({ kind: "key", key: "a" });
			expect(valid.session.consumed).toBe(true);
		}
	});

	it("captures the first usable character from an Android composition", () => {
		const session = createReadOnlyQuickToolsCaptureSession(
			readOnlyTarget(),
			modifiers,
		);
		expect(session).not.toBeNull();

		if (session) {
			const processKey = captureReadOnlyQuickToolsKey(session, {
				type: "keydown",
				key: "Process",
				isComposing: true,
			});
			expect(processKey.outcome).toEqual({ kind: "pending" });

			const beforeInput = captureReadOnlyQuickToolsKey(processKey.session, {
				type: "beforeinput",
				data: "a",
				inputType: "insertCompositionText",
				isComposing: true,
			});
			expect(beforeInput.outcome).toEqual({ kind: "key", key: "a" });

			const input = captureReadOnlyQuickToolsKey(beforeInput.session, {
				type: "input",
				data: "a",
				inputType: "insertCompositionText",
				isComposing: true,
			});
			expect(input.outcome).toEqual({ kind: "duplicate" });

			const completed = captureReadOnlyQuickToolsKey(input.session, {
				type: "compositionend",
				data: "a",
			});
			expect(completed.outcome).toEqual({ kind: "duplicate" });
		}
	});

	it("accepts a printable composing keydown immediately", () => {
		const session = createReadOnlyQuickToolsCaptureSession(
			readOnlyTarget(),
			modifiers,
		);
		expect(session).not.toBeNull();

		if (session) {
			const result = captureReadOnlyQuickToolsKey(session, {
				type: "keydown",
				key: "a",
				isComposing: true,
			});
			expect(result.outcome).toEqual({ kind: "key", key: "a" });
		}
	});

	it("uses a single textarea character during composition when data is null", () => {
		const session = createReadOnlyQuickToolsCaptureSession(
			readOnlyTarget(),
			modifiers,
		);
		expect(session).not.toBeNull();

		if (session) {
			const result = captureReadOnlyQuickToolsKey(session, {
				type: "input",
				data: null,
				value: "a",
				isComposing: true,
			});
			expect(result.outcome).toEqual({ kind: "key", key: "a" });
		}
	});

	it("passes non-printable keydown events to existing navigation handling", () => {
		const session = createReadOnlyQuickToolsCaptureSession(
			readOnlyTarget(),
			modifiers,
		);
		expect(session).not.toBeNull();

		if (session) {
			const result = captureReadOnlyQuickToolsKey(session, {
				type: "keydown",
				key: "ArrowRight",
			});
			expect(result.outcome).toEqual({ kind: "pass" });
			expect(result.session.consumed).toBe(false);
		}
	});

	it("absorbs duplicate events after the first captured key", () => {
		const session = createReadOnlyQuickToolsCaptureSession(
			readOnlyTarget(),
			modifiers,
		);
		expect(session).not.toBeNull();

		if (session) {
			const first = captureReadOnlyQuickToolsKey(session, {
				type: "beforeinput",
				data: "a",
			});
			const duplicate = captureReadOnlyQuickToolsKey(first.session, {
				type: "input",
				data: "a",
				value: "a",
			});
			expect(duplicate.outcome).toEqual({ kind: "duplicate" });
			expect(duplicate.session.consumed).toBe(true);
		}
	});
});
