import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import orientation from "../../src/lib/orientation";

let api, doc, exec;
const flush = async () => {
	for (let i = 0; i < 12; i++) await Promise.resolve();
};
const change = (owner) => {
	doc.fullscreenElement = owner;
	doc.dispatchEvent(new Event("fullscreenchange"));
};
const back = () => doc.dispatchEvent(new Event("fullscreenbackbutton"));

beforeEach(async () => {
	vi.resetModules();
	doc = new EventTarget();
	doc.fullscreenElement = null;
	doc.exitFullscreen = vi.fn(async () => change(null));
	exec = vi.fn((resolve) => resolve());
	vi.stubGlobal("document", doc);
	vi.stubGlobal("cordova", { exec });
	api = (await import("../../src/lib/fullscreen.js")).default;
});
afterEach(() => vi.unstubAllGlobals());

it("validates orientation requests and waits for native lock/unlock acceptance", async () => {
	await expect(orientation.lock("any")).rejects.toThrow(TypeError);
	expect(exec).not.toHaveBeenCalled();
	exec.mockImplementation(() => {});
	for (const mode of ["landscape", "portrait", null]) {
		const settled = vi.fn();
		const request = (mode ? orientation.lock(mode) : orientation.unlock()).then(settled);
		const [success, , service, action, args] = exec.mock.lastCall;
		expect([service, action, args]).toEqual(["System", "set-fullscreen-orientation", [mode]]);
		await Promise.resolve();
		expect(settled).not.toHaveBeenCalled();
		success();
		await request;
	}
	exec.mockImplementation((_success, error) => error("Native failure"));
	await expect(orientation.lock("landscape")).rejects.toThrow("Native failure");
	await expect(orientation.unlock()).rejects.toThrow("Native failure");
});

describe("fullscreen Back ownership", () => {
	it("rejects invalid callbacks and registration outside fullscreen without native changes", async () => {
		for (const value of [undefined, false, "pause", {}]) {
			await expect(api.setBackHandler(value)).rejects.toThrow(TypeError);
		}
		await expect(api.setBackHandler(() => {})).rejects.toThrow(/requires fullscreen/);
		expect(exec).not.toHaveBeenCalled();
		await expect(api.setBackHandler(null)).resolves.toBeUndefined();
		await expect(api.setBackHandler(null)).resolves.toBeUndefined();
		expect(exec.mock.calls.map((call) => call.slice(2))).toEqual([
			["System", "set-fullscreen-back-handler", [false]],
			["System", "set-fullscreen-back-handler", [false]],
		]);
	});

	it("delivers repeated Back until explicit release without changing browser fullscreen", async () => {
		const owner = {};
		const callback = vi.fn();
		change(owner);
		await api.setBackHandler(callback);
		back();
		back();
		back();
		expect(callback).toHaveBeenCalledTimes(3);
		expect(doc.fullscreenElement).toBe(owner);
		expect(doc.exitFullscreen).not.toHaveBeenCalled();
		await api.setBackHandler(null);
		back();
		expect(callback).toHaveBeenCalledTimes(3);
		expect(doc.exitFullscreen).toHaveBeenCalledOnce();
		await flush();
	});

	it("serializes replacement and release so late failure cannot clear a newer callback", async () => {
		change({});
		const old = vi.fn(),
			next = vi.fn();
		await api.setBackHandler(old);
		let reject;
		exec.mockImplementationOnce((_resolve, failure) => {
			reject = failure;
		});
		const failed = api.setBackHandler(() => {});
		const failure = expect(failed).rejects.toThrow("native failure");
		const replacement = api.setBackHandler(next);
		await flush();
		expect(exec).toHaveBeenCalledTimes(2);
		reject("native failure");
		await failure;
		await replacement;
		back();
		expect(next).toHaveBeenCalledOnce();
		expect(old).not.toHaveBeenCalled();
		await api.setBackHandler(null);
		back();
		expect(next).toHaveBeenCalledOnce();
		await flush();
	});

	it("restores the previous registration if a replacement is rejected by native", async () => {
		change({});
		const old = vi.fn();
		await api.setBackHandler(old);
		exec.mockImplementationOnce((_resolve, reject) => reject("backgrounded"));
		await expect(api.setBackHandler(() => {})).rejects.toThrow("backgrounded");
		back();
		expect(old).toHaveBeenCalledOnce();
	});

	it.each(["throw", "reject"])(
		"exits the original session when a callback fails: %s",
		async (kind) => {
			change({});
			await api.setBackHandler(() => {
				if (kind === "throw") throw new Error("pause failed");
				return Promise.reject(new Error("pause failed"));
			});
			back();
			await flush();
			expect(doc.exitFullscreen).toHaveBeenCalledOnce();
		},
	);

	it.each(["replace", "reenter"])("ignores an async callback failure after %s", async (kind) => {
		const owner = {};
		change(owner);
		let reject;
		await api.setBackHandler(
			() =>
				new Promise((_resolve, failure) => {
					reject = failure;
				}),
		);
		back();
		if (kind === "reenter") {
			change(null);
			change(owner);
		}
		const next = vi.fn();
		await api.setBackHandler(next);
		reject(new Error("obsolete callback"));
		await flush();
		expect(doc.exitFullscreen).not.toHaveBeenCalled();
		back();
		expect(next).toHaveBeenCalledOnce();
	});

	it("clears callbacks on owner changes including nested shadow fullscreen", async () => {
		const child = {};
		const shadowRoot = { fullscreenElement: child };
		change({ shadowRoot });
		const callback = vi.fn();
		await api.setBackHandler(callback);
		shadowRoot.fullscreenElement = {};
		doc.dispatchEvent(new Event("fullscreenchange"));
		await flush();
		expect(exec.mock.calls.at(-1)[4]).toEqual([false]);
		back();
		expect(callback).not.toHaveBeenCalled();
		expect(doc.exitFullscreen).toHaveBeenCalledOnce();
	});

	it.each(["resolve", "reject"])(
		"cleans up pending registration after exit and %s, before a new owner registers",
		async (result) => {
			change({});
			const old = vi.fn(),
				queued = vi.fn(),
				next = vi.fn();
			let complete;
			exec.mockImplementationOnce((resolve, reject) => {
				complete = result === "resolve" ? resolve : reject;
			});
			const pending = api.setBackHandler(old);
			const failure = expect(pending).rejects.toThrow();
			const obsolete = api.setBackHandler(queued);
			const obsoleteFailure = expect(obsolete).rejects.toThrow(/session changed/);
			await flush();
			change(null);
			change({});
			const fresh = api.setBackHandler(next);
			complete("old request");
			await failure;
			await obsoleteFailure;
			await fresh;
			expect(exec.mock.calls.map((call) => call[4][0])).toEqual([true, false, true]);
			back();
			expect(next).toHaveBeenCalledOnce();
			expect(old).not.toHaveBeenCalled();
			expect(queued).not.toHaveBeenCalled();
		},
	);

	it("invalidates a queued release on exit so it cannot release the next session", async () => {
		change({});
		let complete;
		exec.mockImplementationOnce((resolve) => {
			complete = resolve;
		});
		const pending = api.setBackHandler(() => {});
		const failure = expect(pending).rejects.toThrow(/session changed/);
		const release = api.setBackHandler(null);
		await flush();
		change(null);
		change({});
		const next = api.setBackHandler(() => {});
		complete();
		await Promise.all([failure, release, next]);
		expect(exec.mock.calls.map((call) => call[4][0])).toEqual([true, false, true]);
	});
});
