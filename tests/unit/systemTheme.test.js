import { afterEach, expect, it, vi } from "vitest";

vi.mock("lib/settings", () => ({ default: { value: {} } }));
vi.mock("theme/list", () => ({ apply: vi.fn() }));
vi.mock("utils/color", () => ({ default: vi.fn() }));

import themes, { updateSystemTheme } from "theme/preInstalled";
import Color from "utils/color";

afterEach(() => vi.resetAllMocks());

it("recalculates dialog dimming when the System theme changes appearance", () => {
	const theme = themes.find(({ id }) => id === "system");
	const darken = vi.fn();
	Color.mockReturnValue({ darken });

	for (const [isDark, primary, dimmed] of [
		[true, "rgb(35, 39, 42)", "#151719"],
		[false, "rgb(255, 255, 255)", "#999999"],
		[true, "rgb(35, 39, 42)", "#151719"],
	]) {
		darken.mockReturnValue({ hex: { toString: () => dimmed } });
		vi.clearAllMocks();

		updateSystemTheme(isDark, false);

		expect(Color).toHaveBeenCalledExactlyOnceWith(primary);
		expect(darken).toHaveBeenCalledExactlyOnceWith(0.4);
		expect(theme.primaryColor).toBe(primary);
		expect(theme.darkenedPrimaryColor).toBe(dimmed);
	}
});
