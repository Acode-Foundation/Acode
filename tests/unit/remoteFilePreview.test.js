import { describe, expect, it, vi } from "vitest";
import { readRemoteFilePreview } from "utils/remoteFilePreview";

function createCache({ exists = false, text = "", error = null } = {}) {
	return {
		exists: vi.fn().mockResolvedValue(exists),
		readFile: error
			? vi.fn().mockRejectedValue(error)
			: vi.fn().mockResolvedValue(text),
	};
}

describe("readRemoteFilePreview", () => {
	it("prefers editor recovery data over the transport cache", async () => {
		const editorCache = createCache({ exists: true, text: "unsaved" });
		const transportCache = createCache({ exists: true, text: "downloaded" });

		await expect(
			readRemoteFilePreview({
				editorCache,
				transportCache,
				encoding: "UTF-8",
			}),
		).resolves.toEqual({ editorCacheExists: true, text: "unsaved" });
		expect(editorCache.readFile).toHaveBeenCalledWith("UTF-8");
		expect(transportCache.exists).not.toHaveBeenCalled();
	});

	it("falls back to the transport cache", async () => {
		const editorCache = createCache();
		const transportCache = createCache({ exists: true, text: "downloaded" });

		await expect(
			readRemoteFilePreview({ editorCache, transportCache }),
		).resolves.toEqual({ editorCacheExists: false, text: "downloaded" });
	});

	it("returns no preview when the transport cache is missing", async () => {
		const editorCache = createCache();
		const transportCache = createCache();

		await expect(
			readRemoteFilePreview({ editorCache, transportCache }),
		).resolves.toEqual({ editorCacheExists: false, text: null });
		expect(transportCache.readFile).not.toHaveBeenCalled();
	});

	it("ignores an unreadable transport cache", async () => {
		const editorCache = createCache();
		const transportCache = createCache({
			exists: true,
			error: new Error("unreadable"),
		});

		await expect(
			readRemoteFilePreview({ editorCache, transportCache }),
		).resolves.toEqual({ editorCacheExists: false, text: null });
	});

	it("preserves editor recovery cache read failures", async () => {
		const error = new Error("recovery cache failed");
		const editorCache = createCache({ exists: true, error });
		const transportCache = createCache({ exists: true, text: "downloaded" });

		await expect(
			readRemoteFilePreview({ editorCache, transportCache }),
		).rejects.toBe(error);
		expect(transportCache.exists).not.toHaveBeenCalled();
	});
});
