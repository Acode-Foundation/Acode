import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import "cm/supportedModes";
import { getModeForPath } from "cm/modelist";
import notificationManager from "lib/notificationManager";
import recommendLanguageModeExtension from "lib/languageModeRecommendations";

vi.mock("lib/notificationManager", () => ({
	default: {
		pushNotification: vi.fn(),
	},
}));

const originalFetch = globalThis.fetch;

globalThis.strings = {
	"extension recommendation title": "Extensions available for {extension}",
	"extension recommendation message": "Search for {keyword}",
	"search plugins": "Search plugins",
};

function recommend(filename) {
	recommendLanguageModeExtension(
		{ type: "editor", filename },
		getModeForPath(filename),
	);
}

describe("language mode recommendations", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterAll(() => {
		globalThis.fetch = originalFetch;
	});

	it("stays silent for arbitrary extensions without a matching plugin", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => [],
		});

		for (const filename of ["test.random", "dhd.sdocx", "hdh.glsl"]) {
			recommend(filename);
		}

		await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(notificationManager.pushNotification).not.toHaveBeenCalled();
	});

	it("recommends a language-mode plugin that exists in the registry", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => [{ id: "example-language-mode" }],
		});

		recommend("test.acodepluginmode");

		await vi.waitFor(() => {
			expect(notificationManager.pushNotification).toHaveBeenCalledOnce();
		});
	});

	it.each([
		["network errors", () => Promise.reject(new Error("offline"))],
		["server errors", () => Promise.resolve({ ok: false, status: 503 })],
	])("retries after transient %s", async (_, failedResponse) => {
		globalThis.fetch = vi
			.fn()
			.mockImplementationOnce(failedResponse)
			.mockResolvedValueOnce({
				ok: true,
				json: async () => [{ id: "recovered-language-mode" }],
			});

		const keyword = `retryable-${crypto.randomUUID()}`;
		recommend(`test.${keyword}`);

		await vi.waitFor(() => {
			expect(globalThis.fetch).toHaveBeenCalledOnce();
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		recommend(`test.${keyword}`);

		await vi.waitFor(() => {
			expect(globalThis.fetch).toHaveBeenCalledTimes(2);
			expect(notificationManager.pushNotification).toHaveBeenCalledOnce();
		});
	});
});
