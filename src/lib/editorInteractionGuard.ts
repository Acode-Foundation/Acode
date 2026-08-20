const GUARDED_TARGETS = "#quick-tools, .notification-item-container";

export const EDITOR_INTERACTION_GUARD_DURATION = 200;

interface EditorInteractionGuardOptions {
	now?: () => number;
	duration?: number;
}

interface ClosestEventTarget extends EventTarget {
	closest?: (selector: string) => Element | null;
}

export function createEditorInteractionGuard({
	now = () => performance.now(),
	duration = EDITOR_INTERACTION_GUARD_DURATION,
}: EditorInteractionGuardOptions = {}) {
	let activeUntil = 0;

	return {
		markActive() {
			activeUntil = now() + duration;
		},

		suppress(event: Event) {
			const target = event.target as ClosestEventTarget | null;
			if (
				now() >= activeUntil ||
				typeof target?.closest !== "function" ||
				!target.closest(GUARDED_TARGETS)
			) {
				return false;
			}

			if (event.cancelable) event.preventDefault();
			event.stopImmediatePropagation();
			return true;
		},
	};
}
