import { beforeEach, describe, expect, it, vi } from "vitest";

const { settings } = vi.hoisted(() => ({
	settings: { value: {} },
}));

vi.mock("lib/settings", () => ({ default: settings }));

import {
	DEFAULT_TERMINAL_SETTINGS,
	getTerminalSettings,
} from "../../src/components/terminal/terminalDefaults.js";

describe("terminal home directory layout settings", () => {
	beforeEach(() => {
		settings.value = {};
	});

	it("merges the home directories by default", () => {
		expect(DEFAULT_TERMINAL_SETTINGS.mergedHomeDirectories).toBe(true);
		expect(getTerminalSettings().mergedHomeDirectories).toBe(true);
	});

	it("honors an explicit opt-out", () => {
		settings.value = {
			terminalSettings: { mergedHomeDirectories: false },
		};

		expect(getTerminalSettings().mergedHomeDirectories).toBe(false);
	});

	it("keeps the merge enabled when only other settings are stored", () => {
		settings.value = {
			terminalSettings: { fontSize: 18 },
		};

		expect(getTerminalSettings().mergedHomeDirectories).toBe(true);
	});
});
