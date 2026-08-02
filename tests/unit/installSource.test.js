import { afterEach, describe, expect, it, vi } from "vitest";
import { INSTALL_SOURCE_PLAY, isPlayStoreInstall } from "utils/installSource";

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("isPlayStoreInstall", () => {
	it("returns true when the app was installed from the Play Store", () => {
		vi.stubGlobal("window", { appInstallSource: INSTALL_SOURCE_PLAY });
		expect(isPlayStoreInstall()).toBe(true);
	});

	it("returns false for any other install source", () => {
		vi.stubGlobal("window", { appInstallSource: "com.android.packageinstaller" });
		expect(isPlayStoreInstall()).toBe(false);
	});

	it("returns false when the install source is unknown", () => {
		vi.stubGlobal("window", {});
		expect(isPlayStoreInstall()).toBe(false);
	});
});
