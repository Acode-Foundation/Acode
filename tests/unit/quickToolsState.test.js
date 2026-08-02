import { describe, expect, it } from "vitest";
import {
	clearModifierState,
	clearQuickToolsButtonFeedback,
	modifierKeys,
	removeActionStackEntries,
} from "handlers/quickToolsState";

describe("clearModifierState", () => {
	it("clears all modifiers and reports the change", () => {
		const state = { shift: true, alt: true, ctrl: true, meta: true };
		expect(clearModifierState(state)).toBe(true);
		for (const key of modifierKeys) {
			expect(state[key]).toBe(false);
		}
	});

	it("emits false for every registered listener", () => {
		const state = { shift: true, alt: false, ctrl: true, meta: false };
		const emitted = [];
		const events = {
			shift: [(value) => emitted.push(["shift", value])],
			alt: [(value) => emitted.push(["alt", value])],
			ctrl: [(value) => emitted.push(["ctrl", value])],
			meta: [(value) => emitted.push(["meta", value])],
		};

		expect(clearModifierState(state, events)).toBe(true);
		expect(emitted).toEqual([
			["shift", false],
			["alt", false],
			["ctrl", false],
			["meta", false],
		]);
	});

	it("returns false when nothing was active", () => {
		const state = { shift: false, alt: false, ctrl: false, meta: false };
		expect(clearModifierState(state)).toBe(false);
	});
});

describe("removeActionStackEntries", () => {
	function fakeStack(initial) {
		const entries = [...initial];
		return {
			entries,
			remove(id) {
				const index = entries.indexOf(id);
				if (index === -1) return false;
				entries.splice(index, 1);
				return true;
			},
		};
	}

	it("removes duplicate entries and counts them", () => {
		const stack = fakeStack(["search-bar", "other", "search-bar"]);
		expect(removeActionStackEntries(stack, "search-bar")).toBe(2);
		expect(stack.entries).toEqual(["other"]);
	});

	it("returns 0 when the id is not present", () => {
		const stack = fakeStack(["other"]);
		expect(removeActionStackEntries(stack, "search-bar")).toBe(0);
		expect(stack.entries).toEqual(["other"]);
	});
});

describe("clearQuickToolsButtonFeedback", () => {
	function fakeButton(initialClasses = [], timeoutId) {
		const classes = new Set(initialClasses);
		return {
			classes,
			dataset: timeoutId !== undefined ? { timeout: String(timeoutId) } : {},
			classList: {
				contains: (c) => classes.has(c),
				remove: (...cs) => cs.forEach((c) => classes.delete(c)),
			},
		};
	}

	function fakeContainer(buttons, matchesItself = false) {
		return {
			matches: () => matchesItself,
			querySelectorAll: () => buttons,
		};
	}

	it("clears active/click state and pending timeouts", () => {
		const active = fakeButton(["icon", "active", "click"], 123);
		const plain = fakeButton(["icon"]);
		const container = fakeContainer([active, plain]);

		expect(clearQuickToolsButtonFeedback([container])).toBe(1);
		expect([...active.classes]).toEqual(["icon"]);
		expect(active.dataset.timeout).toBeUndefined();
		expect([...plain.classes]).toEqual(["icon"]);
	});

	it("clears containers that match themselves", () => {
		const container = fakeButton(["active"], 456);
		container.matches = () => true;
		container.querySelectorAll = () => [];

		expect(clearQuickToolsButtonFeedback([container])).toBe(1);
		expect([...container.classes]).toEqual([]);
		expect(container.dataset.timeout).toBeUndefined();
	});

	it("does not process duplicate containers twice", () => {
		const button = fakeButton(["active"]);
		const container = fakeContainer([button]);

		expect(clearQuickToolsButtonFeedback([container, container])).toBe(1);
	});
});
