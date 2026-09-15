import {
	getFileLanguageExtension,
	preloadFileLanguage,
	waitForFileLanguage,
} from "cm/fileLanguage";
import { describe, expect, it, vi } from "vitest";

describe("restored file language preparation", () => {
	it("loads in parallel with file I/O and supplies a synchronous extension for the first populated state", async () => {
		let resolve!: (value: []) => void;
		const extension: [] = [];
		const provider = vi.fn(
			() =>
				new Promise<[]>((done) => {
					resolve = done;
				}),
		);
		const file = { currentLanguageExtension: provider };
		const preload = preloadFileLanguage(file);
		let published = false;
		const ready = waitForFileLanguage(file).then(() => {
			published = true;
		});
		await Promise.resolve();
		expect(provider).toHaveBeenCalledTimes(1);
		expect(published).toBe(false);
		resolve(extension);
		await Promise.all([preload, ready]);
		expect(getFileLanguageExtension(file)).toBe(extension);
		expect(provider).toHaveBeenCalledTimes(1);
	});
	it("bounds a never-settling provider without restarting it", async () => {
		vi.useFakeTimers();
		try {
			const pending = new Promise<[]>(() => {});
			const provider = vi.fn(() => pending);
			const file = { currentLanguageExtension: provider };
			void preloadFileLanguage(file);
			const published = vi.fn();
			const ready = waitForFileLanguage(file).then(published);
			await vi.advanceTimersByTimeAsync(249);
			expect(published).not.toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(1);
			await ready;
			expect(published).toHaveBeenCalledOnce();
			expect(getFileLanguageExtension(file)).toBe(pending);
			expect(provider).toHaveBeenCalledOnce();
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});
	it.each([
		false,
		true,
	])("keeps late provider settlement handled (reject: %s)", async (rejects) => {
		vi.useFakeTimers();
		try {
			let resolve!: (value: []) => void;
			let reject!: (error: Error) => void;
			const pending = new Promise<[]>((done, fail) => {
				resolve = done;
				reject = fail;
			});
			const file = { currentLanguageExtension: () => pending };
			const preload = preloadFileLanguage(file).catch(() => {});
			const ready = waitForFileLanguage(file);
			await vi.advanceTimersByTimeAsync(250);
			await ready;
			const language = getFileLanguageExtension(file);
			if (rejects) {
				const handled = expect(language).rejects.toThrow("late failure");
				reject(new Error("late failure"));
				await handled;
			} else {
				const extension: [] = [];
				resolve(extension);
				await expect(language).resolves.toBe(extension);
			}
			await preload;
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});
	it("does not reuse an old preparation after a mode change", async () => {
		const oldExtension: [] = [],
			nextExtension: [] = [];
		const file = { currentLanguageExtension: () => oldExtension };
		await preloadFileLanguage(file);
		file.currentLanguageExtension = () => nextExtension;
		expect(getFileLanguageExtension(file)).toBe(nextExtension);
	});
	it("does not cache startup extensions across later settings changes", async () => {
		const extension: [] = [];
		const provider = vi.fn(() => extension);
		const file = { currentLanguageExtension: provider };
		await preloadFileLanguage(file);
		getFileLanguageExtension(file);
		getFileLanguageExtension(file);
		expect(provider).toHaveBeenCalledTimes(2);
	});
	it("lets restored text open if language loading fails", async () => {
		const file = {
			currentLanguageExtension: () =>
				Promise.reject(new Error("missing chunk")),
		};
		const preload = preloadFileLanguage(file);
		const ready = waitForFileLanguage(file);
		await expect(preload).rejects.toThrow("missing chunk");
		await expect(ready).resolves.toBeUndefined();
	});
});
