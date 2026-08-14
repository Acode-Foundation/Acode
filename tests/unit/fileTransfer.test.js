import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	copyEntry: vi.fn(),
	deleteSource: vi.fn(),
	copyTo: vi.fn(),
	moveTo: vi.fn(),
}));

vi.mock("utils/copyEntry", () => ({ default: mocks.copyEntry }));
vi.mock("fileSystem", () => ({
	default: () => ({
		delete: mocks.deleteSource,
		copyTo: mocks.copyTo,
		moveTo: mocks.moveTo,
	}),
}));

import transferEntry, {
	shouldUseRecursiveTransfer,
} from "utils/fileTransfer";

describe("file transfers", () => {
	beforeEach(() => vi.clearAllMocks());

	it("uses recursive transfer between private files and SAF", async () => {
		mocks.copyEntry.mockResolvedValue({
			url: "content://provider/tree/root::project",
			copied: 4,
			skipped: 0,
		});

		const result = await transferEntry(
			"file:///data/user/0/app/files/project",
			"content://provider/tree/root",
		);

		expect(shouldUseRecursiveTransfer("file:///a", "content://b")).toBe(true);
		expect(result.recursive).toBe(true);
		expect(mocks.copyTo).not.toHaveBeenCalled();
	});

	it("deletes a move source only after every recursive copy succeeds", async () => {
		mocks.copyEntry.mockResolvedValue({ url: "content://target/item", copied: 2 });
		await transferEntry("file:///source", "content://target", {
			operation: "move",
		});
		expect(mocks.deleteSource).toHaveBeenCalledTimes(1);
	});

	it("preserves a move source when recursive copying fails", async () => {
		mocks.copyEntry.mockRejectedValue(new Error("SAF write failed"));
		await expect(
			transferEntry("file:///source", "content://target", {
				operation: "move",
			}),
		).rejects.toThrow("SAF write failed");
		expect(mocks.deleteSource).not.toHaveBeenCalled();
	});

	it("preserves a move source when any entry was skipped", async () => {
		mocks.copyEntry.mockResolvedValue({
			url: "content://target/item",
			copied: 2,
			skipped: 1,
		});
		await expect(
			transferEntry("file:///source", "content://target", {
				operation: "move",
			}),
		).rejects.toThrow("source was preserved");
		expect(mocks.deleteSource).not.toHaveBeenCalled();
	});

	it("keeps the native fast path within one filesystem scheme", async () => {
		mocks.copyTo.mockResolvedValue("file:///target/item");
		const result = await transferEntry("file:///source", "file:///target");
		expect(result).toMatchObject({
			url: "file:///target/item",
			recursive: false,
		});
		expect(mocks.copyEntry).not.toHaveBeenCalled();
	});
});
