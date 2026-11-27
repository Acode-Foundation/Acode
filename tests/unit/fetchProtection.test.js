import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import installAPITransport from "../../src/platforms/ios/api";

const source = readFileSync(
	new URL("../../src/lib/polyfill.js", import.meta.url),
	"utf8",
);
let window;
let transport;
let warning;

beforeEach(() => {
	window = new Window({ url: "https://localhost/" });
	transport = vi.fn(async () => new Response("authenticated"));
	window.fetch = transport;
	warning = vi.spyOn(window.console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
	await window.happyDOM.abort();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

test("plugins cannot replace, redefine or delete the host fetch transport", async () => {
	window.eval(source);
	const fetch = window.fetch;
	// Legacy wrappers also assign in strict mode; they must not break startup.
	window.eval(
		'"use strict"; window.fetch = () => { throw Error("replaced"); };',
	);
	expect(window.fetch).toBe(fetch);
	expect(warning).toHaveBeenCalledExactlyOnceWith(
		"Acode blocked an attempt to replace window.fetch. Use a local fetch wrapper instead.",
	);
	expect(Reflect.defineProperty(window, "fetch", { value: vi.fn() })).toBe(
		false,
	);
	expect(Reflect.deleteProperty(window, "fetch")).toBe(false);
	const response = await window.fetch("https://dev.acode.app/api/login", {
		cache: "no-store",
	});
	expect(await response.text()).toBe("authenticated");
	expect(transport).toHaveBeenLastCalledWith(
		"https://dev.acode.app/api/login",
		{
			cache: "no-store",
			credentials: "include",
		},
	);
	const request = new window.Request("https://example.test/provider", {
		method: "POST",
		body: "message",
	});
	await window.fetch(request, { credentials: "omit" });
	expect(transport).toHaveBeenLastCalledWith(request, {
		credentials: "omit",
	});
});

test("protects the already installed iOS transport and preserves authenticated API routing", async () => {
	for (const [name, value] of Object.entries({
		window,
		location: window.location,
		XMLHttpRequest: window.XMLHttpRequest,
		Request: window.Request,
		Headers: window.Headers,
	}))
		vi.stubGlobal(name, value);
	installAPITransport();
	window.eval(source);
	for (const origin of ["https://acode.app", "https://dev.acode.app"]) {
		const response = await window.fetch(`${origin}/api/login`, {
			cache: "no-store",
		});
		const [url, options] = transport.mock.calls.at(-1);
		expect(url).toBe("acode://localhost/__api__/login");
		expect(options.headers.get("X-Acode-API-Origin")).toBe(origin);
		expect(options.headers.get("X-Acode-Credentials")).toBe("include");
		expect(await response.text()).toBe("authenticated");
	}
});
