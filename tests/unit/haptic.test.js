import { afterEach, expect, it, vi } from "vitest";
import haptic from "../../src/utils/haptic";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

it("uses the existing Proteus haptic service on iOS", () => {
	const exec = vi.fn();
	const vibrate = vi.fn();
	vi.stubGlobal("Bridge", { platformId: "ios", exec });
	vi.stubGlobal("navigator", { vibrate });
	haptic(30);
	expect(exec).toHaveBeenCalledWith(null, null, "Native", "haptic", []);
	expect(vibrate).not.toHaveBeenCalled();
});

it("preserves Android vibration durations and navigator receiver", () => {
	const calls = [];
	const navigator = {
		vibrate(duration) {
			calls.push([this, duration]);
		},
	};
	vi.stubGlobal("Bridge", { platformId: "android" });
	vi.stubGlobal("navigator", navigator);
	for (const duration of [30, 50, 150]) haptic(duration);
	expect(calls).toEqual([30, 50, 150].map((duration) => [navigator, duration]));
});

it("leaves controls usable when vibration is unavailable", () => {
	vi.stubGlobal("Bridge", undefined);
	vi.stubGlobal("navigator", {});
	expect(() => haptic(30)).not.toThrow();
});

it("does not let a native feedback failure interrupt the control action", () => {
	const error = new Error("Native bridge unavailable");
	vi.stubGlobal("Bridge", {
		platformId: "ios",
		exec() {
			throw error;
		},
	});
	const log = vi.spyOn(console, "error").mockImplementation(() => {});
	expect(() => haptic(30)).not.toThrow();
	expect(log).toHaveBeenCalledWith("Haptic feedback failed", error);
});
