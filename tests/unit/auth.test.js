import { afterEach, beforeEach, expect, test, vi } from "vitest";

let auth;
let loginEvents;
let exec;
let request;

beforeEach(async () => {
	vi.resetModules();
	vi.useFakeTimers();
	vi.stubGlobal("document", new EventTarget());
	vi.stubGlobal("window", { BuildInfo: { versionCode: 1016 } });
	vi.stubGlobal("localStorage", {
		getItem(key) {
			return this[key] ?? null;
		},
		setItem(key, value) {
			this[key] = value;
		},
		removeItem(key) {
			delete this[key];
		},
	});
	exec = vi.fn();
	request = vi.fn();
	vi.stubGlobal("Bridge", { exec });
	vi.stubGlobal("fetch", request);
	({ default: auth, loginEvents } = await import("../../src/lib/auth"));
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

test("coalesces native login without an extra request and invalidates the previous account", async () => {
	request.mockResolvedValueOnce(new Response(JSON.stringify({ id: 7 })));
	await auth.getLoggedInUser();
	request.mockClear();
	request.mockRejectedValue(new Error("Offline after native sign-in"));
	const completed = vi.fn();
	loginEvents.addListener(completed);
	const first = auth.login();
	const second = auth.login();
	expect(exec).toHaveBeenCalledTimes(1);
	expect(exec.mock.calls[0].slice(2)).toEqual([
		"Authenticator",
		"login",
		[{ baseUrl: "https://acode.app", appVersionCode: 1016 }],
	]);
	exec.mock.calls[0][0]();
	await Promise.all([first, second]);
	expect(completed).toHaveBeenCalledOnce();
	expect(request).not.toHaveBeenCalled();
	expect(localStorage["cached-logged-in-user"]).toBeUndefined();
	request.mockResolvedValue(new Response(JSON.stringify({ id: 8 })));
	expect((await auth.getLoggedInUser()).id).toBe(8);
	expect(request).toHaveBeenCalledWith("https://acode.app/api/login", {
		cache: "no-store",
	});
});

test("a rejected account refresh clears cached account state", async () => {
	request.mockResolvedValueOnce(new Response(JSON.stringify({ id: 7 })));
	await auth.getLoggedInUser();
	request.mockImplementation(async () => new Response("{}", { status: 401 }));
	expect(await auth.getLoggedInUser(true)).toBeNull();
	expect(await auth.getLoggedInUser()).toBeNull();
	expect(localStorage["cached-logged-in-user"]).toBeUndefined();
});

test("an idle resume cannot time out a later browser sign-in", async () => {
	document.dispatchEvent(new Event("resume"));
	await vi.advanceTimersByTimeAsync(50_000);
	const completed = vi.fn();
	loginEvents.addListener(completed);
	const pending = auth.login();
	const outcome = pending.then(
		() => "success",
		(error) => error.message,
	);
	await vi.advanceTimersByTimeAsync(20_000);
	exec.mock.calls[0][0]();
	expect(await outcome).toBe("success");
	expect(completed).toHaveBeenCalledOnce();
});

test("returning to the browser cancels the resume deadline until the next return", async () => {
	const pending = auth.login();
	const outcome = pending.then(
		() => "success",
		(error) => error.message,
	);
	document.dispatchEvent(new Event("resume"));
	await vi.advanceTimersByTimeAsync(30_000);
	document.dispatchEvent(new Event("pause"));
	await vi.advanceTimersByTimeAsync(90_000);
	document.dispatchEvent(new Event("resume"));
	exec.mock.calls[0][0]();
	expect(await outcome).toBe("success");
});

test("preserves actionable native errors for every waiter and permits a new attempt", async () => {
	vi.spyOn(console, "error").mockImplementation(() => {});
	const message =
		"Too many sign-in attempts. Please wait 2 minutes and try again.";
	const first = expect(auth.login()).rejects.toThrow(message);
	const second = expect(auth.login()).rejects.toThrow(message);
	exec.mock.calls[0][1](message);
	await Promise.all([first, second]);
	const retry = expect(auth.login()).rejects.toThrow("Sign-in cancelled");
	expect(exec).toHaveBeenCalledTimes(2);
	exec.mock.calls[1][1]("Sign-in cancelled");
	await retry;

	const timedOut = expect(auth.login()).rejects.toThrow("Sign-in timed out");
	document.dispatchEvent(new Event("resume"));
	await vi.advanceTimersByTimeAsync(60_000);
	await timedOut;
	const nextAttempt = expect(auth.login()).rejects.toThrow(
		"Current attempt failed",
	);
	exec.mock.calls[2][1]("Previous attempt cancelled");
	await Promise.resolve();
	exec.mock.calls[3][1]("Current attempt failed");
	await nextAttempt;
});

test("a forced account refresh cannot fall back to an offline cached account", async () => {
	vi.spyOn(console, "error").mockImplementation(() => {});
	localStorage.setItem("cached-logged-in-user", JSON.stringify({ id: 7 }));
	request.mockRejectedValue(new Error("Connection failed"));
	await expect(auth.getLoggedInUser()).resolves.toEqual({ id: 7 });
	await expect(auth.getLoggedInUser(true)).rejects.toThrow("Connection failed");
});

test("account settings use the authentication browser and refresh after it closes", async () => {
	request.mockResolvedValue(new Response("{}", { status: 401 }));
	const pending = auth.openAccount();
	const [closed, , service, action, args] = exec.mock.calls[0];
	expect([service, action, args]).toEqual([
		"Authenticator",
		"openAccount",
		[{ baseUrl: "https://acode.app" }],
	]);
	expect(request).not.toHaveBeenCalled();
	closed();
	await expect(pending).resolves.toBeNull();
	expect(request).toHaveBeenCalledTimes(1);
});

test("closing account settings offline skips refresh without reporting a signed-out session", async () => {
	vi.spyOn(console, "error").mockImplementation(() => {});
	request.mockResolvedValueOnce(new Response(JSON.stringify({ id: 7 })));
	await auth.getLoggedInUser();
	await vi.advanceTimersByTimeAsync(600_000);
	request.mockRejectedValue(new Error("Offline"));
	const pending = auth.openAccount();
	exec.mock.calls[0][0]();
	await expect(pending).resolves.toBeUndefined();
});
