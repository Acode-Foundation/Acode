import { afterEach, beforeEach, expect, test, vi } from "vitest";
import installAPITransport from "../../src/platforms/ios/api";

let transport: ReturnType<typeof vi.fn>;
let window: { fetch: typeof fetch };

beforeEach(() => {
	transport = vi.fn(async () => new Response("fixture"));
	window = { fetch: transport };
	vi.stubGlobal("window", window);
	vi.stubGlobal("location", { href: "acode://localhost/" });
	class XHR extends EventTarget {
		readyState = 1;
		withCredentials = false;
		headers: Record<string, string> = {};
		open(...args: unknown[]) {
			Object.assign(this, { openArgs: args });
		}
		send(body: unknown) {
			Object.assign(this, { sentBody: body });
		}
		abort() {
			Object.assign(this, { aborted: true });
		}
		get responseURL() {
			return "browser-url";
		}
		setRequestHeader(name: string, value: string) {
			this.headers[name] = value;
		}
		getResponseHeader() {
			return "https://acode.app/api/final";
		}
	}
	vi.stubGlobal("XMLHttpRequest", XHR);
	vi.stubGlobal("ProgressEvent", Event);
	installAPITransport();
});

test("normalizes multipart XHR and cancels pending body preparation", async () => {
	const form = new FormData();
	form.append("file", new Blob(["✓ bytes"]), "fixture.txt");
	const xhr = new XMLHttpRequest();
	xhr.open("POST", "https://acode.app/api/upload");
	xhr.send(form);
	await vi.waitFor(() =>
		expect((xhr as unknown as { sentBody: unknown }).sentBody).toBeInstanceOf(
			ArrayBuffer,
		),
	);
	const state = xhr as unknown as {
		sentBody: ArrayBuffer;
		headers: Record<string, string>;
	};
	expect(new TextDecoder().decode(state.sentBody)).toContain("✓ bytes");
	expect(state.headers["Content-Type"]).toContain(
		"multipart/form-data; boundary=",
	);
	const cancelled = new XMLHttpRequest();
	cancelled.open("POST", "https://acode.app/api/upload");
	const aborted = vi.fn();
	cancelled.addEventListener("abort", aborted);
	cancelled.send(form);
	cancelled.abort();
	await new Promise((resolve) => setTimeout(resolve, 10));
	expect(aborted).toHaveBeenCalledOnce();
	expect(
		(cancelled as unknown as { sentBody: unknown }).sentBody,
	).toBeUndefined();
});
afterEach(() => vi.unstubAllGlobals());

test("only routes Acode HTTPS API requests through the iOS transport", async () => {
	for (const url of [
		"https://example.com/api/login",
		"https://acode.app.evil.test/api/login",
		"http://acode.app/api/login",
		"https://acode.app:8443/api/login",
		"https://acode.app/plugins",
		"https://dev.acode.app.evil.test/api/login",
		"http://dev.acode.app/api/login",
		"https://dev.acode.app:8443/api/login",
		"acode://localhost/__cdvfile_cache__/file.txt",
	]) {
		await window.fetch(url);
		expect(transport.mock.calls.at(-1)?.[0]).toBe(url);
	}
	for (const origin of ["https://acode.app", "https://dev.acode.app"]) {
		await window.fetch(`${origin}/api/login?test=one%20two`, {
			credentials: "include",
			headers: { "X-Acode-API-Origin": "https://example.com" },
		});
		const [url, options] = transport.mock.calls.at(-1)!;
		expect(url).toBe("acode://localhost/__api__/login?test=one%20two");
		expect(options.headers.get("X-Acode-Credentials")).toBe("include");
		expect(options.headers.get("X-Acode-API-Origin")).toBe(origin);
		const xhr = new XMLHttpRequest();
		xhr.open("GET", `${origin}/api/login`);
		xhr.withCredentials = true;
		xhr.send();
		const state = xhr as unknown as {
			openArgs: unknown[];
			headers: Record<string, string>;
		};
		expect(state.openArgs[1]).toBe("acode://localhost/__api__/login");
		expect(state.headers["X-Acode-API-Origin"]).toBe(origin);
		expect(state.headers["X-Acode-Credentials"]).toBe("include");
	}
});

test("retains Request bodies, content types, cancellation and response URLs", async () => {
	transport.mockImplementation(
		async () =>
			new Response("ok", {
				headers: { "X-Acode-Response-URL": "https://acode.app/api/final" },
			}),
	);
	const controller = new AbortController();
	const body = new FormData();
	body.append("message", "✓ # %");
	const request = new Request("https://acode.app/api/example", {
		method: "POST",
		body,
		signal: controller.signal,
		credentials: "omit",
	});
	const response = await window.fetch(request);
	const options = transport.mock.calls.at(-1)![1];
	expect(new TextDecoder().decode(options.body)).toContain("✓ # %");
	expect(options.headers.get("content-type")).toMatch(
		/^multipart\/form-data; boundary=/,
	);
	expect(options.headers.get("X-Acode-Credentials")).toBe("omit");
	controller.abort();
	expect(options.signal.aborted).toBe(true);
	expect(response.url).toBe("https://acode.app/api/final");
	expect(response.redirected).toBe(true);
	expect(response.clone().url).toBe(response.url);
	expect(await response.text()).toBe("ok");
});

test("preserves XHR methods and credentials without replacing the browser class", () => {
	const xhr = new XMLHttpRequest();
	xhr.open("POST", "https://acode.app/api/review", true);
	xhr.withCredentials = true;
	xhr.send("body");
	expect(
		(xhr as unknown as { headers: Record<string, string> }).headers[
			"X-Acode-Credentials"
		],
	).toBe("include");
	Object.assign(xhr, { readyState: 4 });
	expect(xhr.responseURL).toBe("https://acode.app/api/final");
	xhr.open("GET", "https://example.com/");
	expect(xhr.responseURL).toBe("browser-url");
});
