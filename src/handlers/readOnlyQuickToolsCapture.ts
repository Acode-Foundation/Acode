interface ReadOnlyCaptureTarget {
	state?: {
		readOnly?: boolean;
	};
}

export interface QuickToolsModifierSnapshot {
	shiftKey: boolean;
	altKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
}

export interface ReadOnlyQuickToolsCaptureSession<
	Target extends ReadOnlyCaptureTarget = ReadOnlyCaptureTarget,
> {
	target: Target;
	modifiers: QuickToolsModifierSnapshot;
	consumed: boolean;
}

export interface ReadOnlyQuickToolsCaptureEvent {
	type: "keydown" | "beforeinput" | "input" | "compositionend";
	key?: string | null;
	data?: string | null;
	value?: string | null;
	inputType?: string | null;
	isComposing?: boolean;
}

export type ReadOnlyQuickToolsCaptureOutcome =
	| { kind: "key"; key: string }
	| { kind: "pending" }
	| { kind: "duplicate" }
	| { kind: "pass" };

export interface ReadOnlyQuickToolsCaptureResult<
	Target extends ReadOnlyCaptureTarget = ReadOnlyCaptureTarget,
> {
	session: ReadOnlyQuickToolsCaptureSession<Target>;
	outcome: ReadOnlyQuickToolsCaptureOutcome;
}

/**
 * Create a one-shot soft-keyboard capture only for a read-only CodeMirror
 * target. Editable editors intentionally stay on the established QuickTools
 * input path.
 */
export function createReadOnlyQuickToolsCaptureSession<
	Target extends ReadOnlyCaptureTarget,
>(
	target: Target | null | undefined,
	modifiers: Partial<QuickToolsModifierSnapshot>,
): ReadOnlyQuickToolsCaptureSession<Target> | null {
	if (!target?.state?.readOnly) return null;
	return {
		target,
		modifiers: {
			shiftKey: !!modifiers.shiftKey,
			altKey: !!modifiers.altKey,
			ctrlKey: !!modifiers.ctrlKey,
			metaKey: !!modifiers.metaKey,
		},
		consumed: false,
	};
}

/**
 * Normalize the event variants emitted by Android keyboards. A session is
 * consumed by the first unambiguous character and then absorbs duplicate DOM
 * events generated for that same keystroke.
 */
export function captureReadOnlyQuickToolsKey<
	Target extends ReadOnlyCaptureTarget,
>(
	session: ReadOnlyQuickToolsCaptureSession<Target>,
	event: ReadOnlyQuickToolsCaptureEvent,
): ReadOnlyQuickToolsCaptureResult<Target> {
	if (session.consumed) {
		return { session, outcome: { kind: "duplicate" } };
	}

	if (event.type === "keydown") {
		if (isCompositionKey(event.key)) {
			return { session, outcome: { kind: "pending" } };
		}
		// Gboard can mark a real printable key as composing. Waiting for
		// compositionend here leaves the shortcut armed until the IME is dismissed.
		const key = getSingleCharacter(event.key);
		if (!key) return { session, outcome: { kind: "pass" } };
		return consumeSession(session, key);
	}

	if (event.inputType?.startsWith("delete")) {
		return { session, outcome: { kind: "pending" } };
	}

	if (event.data !== null && event.data !== undefined) {
		// A single composition update is already an unambiguous shortcut key.
		const key = getSingleCharacter(event.data);
		return key
			? consumeSession(session, key)
			: { session, outcome: { kind: "pending" } };
	}

	const key = getSingleCharacter(event.value);
	return key
		? consumeSession(session, key)
		: { session, outcome: { kind: "pending" } };
}

function consumeSession<Target extends ReadOnlyCaptureTarget>(
	session: ReadOnlyQuickToolsCaptureSession<Target>,
	key: string,
): ReadOnlyQuickToolsCaptureResult<Target> {
	return {
		session: { ...session, consumed: true },
		outcome: { kind: "key", key },
	};
}

function getSingleCharacter(value: string | null | undefined): string | null {
	if (!value) return null;
	const characters = Array.from(value);
	return characters.length === 1 ? characters[0] : null;
}

function isCompositionKey(key: string | null | undefined): boolean {
	return key === "Dead" || key === "Process" || key === "Unidentified";
}
