export const modifierKeys = ["shift", "alt", "ctrl", "meta"];

/**
 * CodeMirror can safely receive Shift-only text because replacing the current
 * selection is intentional. Command modifiers must capture text outside the
 * contenteditable so Android keyboards cannot mutate the document first.
 */
export function shouldCaptureModifierInput(state, isCodeMirrorTarget) {
	const hasActiveModifier = modifierKeys.some((key) => Boolean(state[key]));
	if (!hasActiveModifier) return false;
	if (!isCodeMirrorTarget) return true;
	return Boolean(state.ctrl || state.alt || state.meta);
}

export function clearModifierState(state, events = {}) {
	let changed = false;

	for (const key of modifierKeys) {
		if (state[key]) changed = true;
		state[key] = false;
		events[key]?.forEach((callback) => callback(false));
	}

	return changed;
}

export function clearQuickToolsButtonFeedback(containers = []) {
	const visitedContainers = new Set();
	const visitedButtons = new Set();
	let cleared = 0;

	for (const container of containers) {
		if (!container || visitedContainers.has(container)) continue;
		visitedContainers.add(container);

		const buttons = [
			...(container.matches?.(".active, .click, [data-timeout]")
				? [container]
				: []),
			...(container.querySelectorAll?.(".active, .click, [data-timeout]") ||
				[]),
		];

		for (const button of buttons) {
			if (!button || visitedButtons.has(button)) continue;
			visitedButtons.add(button);
			if (button.dataset?.timeout) {
				clearTimeout(Number(button.dataset.timeout));
				delete button.dataset.timeout;
			}
			if (
				button.classList?.contains("active") ||
				button.classList?.contains("click")
			) {
				button.classList.remove("active", "click");
				cleared++;
			}
		}
	}

	return cleared;
}

export function removeActionStackEntries(actionStack, id) {
	let removed = 0;
	while (actionStack.remove(id)) {
		removed++;
	}
	return removed;
}
