export const modifierKeys = ["shift", "alt", "ctrl", "meta"];

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
	const visited = new Set();
	let cleared = 0;

	for (const container of containers) {
		if (!container || visited.has(container)) continue;
		visited.add(container);

		const buttons = [
			...(container.matches?.(".active, .click, [data-timeout]")
				? [container]
				: []),
			...(container.querySelectorAll?.(".active, .click, [data-timeout]") ||
				[]),
		];

		for (const button of buttons) {
			if (!button || visited.has(button)) continue;
			visited.add(button);
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
