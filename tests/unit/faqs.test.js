// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import strings from "../../src/lang/en-us.json";
import setup from "../helpers/faqsPage";

afterEach(() => {
	for (const page of [...document.body.children]) page.hide?.();
	document.body.replaceChildren();
	localStorage.clear();
	if (vi.isFakeTimers()) vi.clearAllTimers();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

it("renders API FAQs in the app, sanitizes answers, and searches questions and answers", async () => {
	vi.useFakeTimers();
	const fetch = vi.fn().mockResolvedValue(
		response([
			{
				q: "Open a folder?",
				a: "Use **Open folder**. [Help](/faqs/folders)<script>alert(1)</script><img src=x onerror=alert(1)>",
			},
			{ q: "Edit files?", a: "Use the editor." },
		]),
	);
	const { page } = setup(fetch);
	expect(page.textContent).toContain(strings["loading..."]);
	await vi.waitFor(() =>
		expect(page.querySelectorAll("details")).toHaveLength(2),
	);
	expect(fetch).toHaveBeenCalledWith(
		"https://acode.app/api/faqs?platform=android",
		expect.objectContaining({
			signal: expect.any(AbortSignal),
			cache: "no-store",
		}),
	);
	const first = page.querySelector("details");
	first.open = true;
	first.dispatchEvent(new Event("toggle"));
	expect(first.querySelector("strong").textContent).toBe("Open folder");
	expect(first.querySelector("a").href).toBe("https://acode.app/faqs/folders");
	expect(first.querySelector("script, [onerror]")).toBeNull();
	expect(page.querySelector(".faq-count").textContent.trim()).toBe("2 results");
	expect(page.querySelector("input")).toBeNull();
	page.querySelector("header button").click();
	const search = document.querySelector("#search-bar input");
	expect(document.activeElement).toBe(search);
	search.value = "EDITOR";
	search.dispatchEvent(new Event("input"));
	await vi.advanceTimersByTimeAsync(500);
	expect(page.querySelectorAll("details")).toHaveLength(1);
	expect(page.querySelector(".faq-count").textContent.trim()).toBe("1 result");
	expect(page.querySelector("summary").textContent.trim()).toBe("Edit files?");
	search.value = "missing";
	search.dispatchEvent(new Event("input"));
	await vi.advanceTimersByTimeAsync(500);
	expect(page.querySelector('.faq-list [role="status"]').textContent).toBe(
		strings["no result"],
	);
	search.value = "";
	search.dispatchEvent(new Event("input"));
	await vi.advanceTimersByTimeAsync(500);
	expect(page.querySelector("details")).toBe(first);
	expect(first.open).toBe(true);
	search.value = "missing";
	search.dispatchEvent(new Event("input"));
	document.querySelector("#search-bar .clearclose").click();
	await vi.advanceTimersByTimeAsync(500);
	expect(document.querySelector("#search-bar")).toBeNull();
	expect(page.querySelectorAll("details")).toHaveLength(2);
});

it.each([
	"offline",
	"empty cache",
	"http",
	"malformed",
])("shows feedback after %s failure and supports retry", async (failure) => {
	vi.spyOn(console, "error").mockImplementation(() => {});
	const fetch = vi.fn();
	if (failure === "empty cache")
		localStorage.setItem("faqs:https://acode.app/api:android", "[]");
	if (failure === "offline" || failure === "empty cache")
		fetch.mockRejectedValueOnce(new TypeError("Network unavailable"));
	else
		fetch.mockResolvedValueOnce(
			failure === "http"
				? { ok: false, status: 503 }
				: response({ error: "Invalid" }),
		);
	fetch.mockResolvedValue(response([{ q: "Recovered?", a: "Yes." }]));
	const { page } = setup(fetch, {
		...strings,
		retry: undefined,
		"faqs load failed": undefined,
	});
	const retry = page.querySelector(".faq-retry");
	expect(retry.textContent.trim()).toBe(strings.retry);
	await vi.waitFor(() => expect(retry.hidden).toBe(false));
	expect(page.textContent).toContain(strings["faqs load failed"]);
	retry.click();
	expect(retry.hidden).toBe(true);
	await vi.waitFor(() =>
		expect(page.querySelector("summary")?.textContent.trim()).toBe(
			"Recovered?",
		),
	);
	expect(fetch).toHaveBeenCalledTimes(2);
});

it("shows an empty response without leaving the loading indicator", async () => {
	const { page } = setup(vi.fn().mockResolvedValue(response([])), {
		...strings,
		"faqs empty": undefined,
	});
	await vi.waitFor(() =>
		expect(page.textContent).toContain(strings["faqs empty"]),
	);
	expect(page.querySelector(".faq-retry").hidden).toBe(true);
});

it("times out a stalled request and cancels pending work when closed", async () => {
	vi.useFakeTimers();
	vi.spyOn(console, "error").mockImplementation(() => {});
	const signals = [];
	const fetch = vi.fn(
		(url, { signal }) =>
			new Promise((resolve, reject) => {
				signals.push(signal);
				signal.addEventListener("abort", () =>
					reject(new DOMException("Aborted", "AbortError")),
				);
			}),
	);
	const { page, remove } = setup(fetch);
	await vi.advanceTimersByTimeAsync(15000);
	expect(signals[0].aborted).toBe(true);
	expect(page.querySelector(".faq-retry").hidden).toBe(false);
	page.querySelector(".faq-retry").click();
	page.hide();
	page.querySelector(".faq-retry").click();
	expect(fetch).toHaveBeenCalledTimes(2);
	await vi.advanceTimersByTimeAsync(0);
	expect(signals[1].aborted).toBe(true);
	expect(remove).toHaveBeenCalledWith("faqs");
	expect(vi.getTimerCount()).toBe(0);
});

it("keeps loading and back navigation alive across temporary removal and restore", async () => {
	let finish;
	const fetch = vi.fn().mockImplementation(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	const { page, remove } = setup(fetch);
	const signal = fetch.mock.calls[0][1].signal;
	page.remove();
	page.ondisconnect();
	expect(signal.aborted).toBe(false);
	expect(remove).not.toHaveBeenCalledWith("faqs");
	finish(response([{ q: "Restored FAQ?", a: "Answer." }]));
	await vi.waitFor(() => expect(page.querySelector("summary")).not.toBeNull());
	document.body.append(page);
	page.onconnect?.();
	expect(page.querySelector("summary").textContent.trim()).toBe(
		"Restored FAQ?",
	);
	page.querySelector("header button").click();
	expect(document.querySelector("#search-bar")).not.toBeNull();
	page.remove();
	page.ondisconnect();
	await vi.waitFor(() =>
		expect(document.querySelector("#search-bar")).toBeNull(),
	);
	expect(remove).not.toHaveBeenCalledWith("faqs");
	document.body.append(page);
	page.onconnect?.();
	page.querySelector("header button").click();
	expect(document.querySelector("#search-bar")).not.toBeNull();
	page.hide();
	expect(remove).toHaveBeenCalledWith("faqs");
});

it("loads fresh FAQs before showing content and saves them for offline use", async () => {
	vi.useFakeTimers();
	const saved = [{ q: "Open files?", a: "Use the editor." }];
	const first = setup(vi.fn().mockResolvedValue(response(saved))).page;
	await vi.waitFor(() => expect(first.querySelector("summary")).not.toBeNull());
	first.hide();

	let finish;
	const pending = new Promise((resolve) => {
		finish = resolve;
	});
	const online = setup(vi.fn().mockReturnValue(pending)).page;
	expect(online.querySelector("summary")).toBeNull();
	expect(online.textContent).toContain(strings["loading..."]);
	expect(online.querySelector("header button").disabled).toBe(true);
	const refreshed = [{ q: "Updated FAQ?", a: "New answer." }];
	finish(response(refreshed));
	await vi.advanceTimersByTimeAsync(0);
	expect(online.querySelector("summary").textContent.trim()).toBe(
		"Updated FAQ?",
	);
	expect(online.querySelector("header button").disabled).toBe(false);
	expect(online.querySelector(".faq-count").textContent.trim()).toBe(
		"1 result",
	);
	online.hide();

	const offline = setup(
		vi.fn().mockRejectedValue(new TypeError("Offline")),
	).page;
	await vi.advanceTimersByTimeAsync(0);
	expect(offline.querySelector("summary").textContent.trim()).toBe(
		"Updated FAQ?",
	);
	expect(offline.querySelector(".faq-retry").hidden).toBe(true);
	expect(offline.textContent).not.toContain(strings["faqs load failed"]);
});

it("replaces stale cached FAQs when the network returns an empty list", async () => {
	const key = "faqs:https://acode.app/api:android";
	localStorage.setItem(key, JSON.stringify([{ q: "Removed?", a: "Old." }]));
	const { page } = setup(vi.fn().mockResolvedValue(response([])));
	await vi.waitFor(() =>
		expect(page.textContent).toContain(strings["faqs empty"]),
	);
	expect(page.querySelector("summary")).toBeNull();
	expect(localStorage.getItem(key)).toBe("[]");
});

it("keeps the saved copy when a refresh response is invalid", async () => {
	vi.useFakeTimers();
	const key = "faqs:https://acode.app/api:android";
	const saved = JSON.stringify([{ q: "Saved FAQ?", a: "Saved answer." }]);
	localStorage.setItem(key, saved);
	const { page } = setup(
		vi.fn().mockResolvedValue(response([{ q: "Missing answer" }])),
	);
	await vi.advanceTimersByTimeAsync(0);
	expect(page.querySelector("summary").textContent.trim()).toBe("Saved FAQ?");
	expect(localStorage.getItem(key)).toBe(saved);
});

it.each([
	"[]",
	"broken json",
	'[{"q":null,"a":"Invalid"}]',
])("still renders fresh FAQs when the cache is empty or invalid (%s) and storage is full", async (cached) => {
	localStorage.setItem("faqs:https://acode.app/api:android", cached);
	vi.spyOn(console, "warn").mockImplementation(() => {});
	vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
		throw new DOMException("Storage full", "QuotaExceededError");
	});
	const { page } = setup(
		vi.fn().mockResolvedValue(response([{ q: "Fresh FAQ?", a: "Answer." }])),
	);
	await vi.waitFor(() =>
		expect(page.querySelector("summary")?.textContent.trim()).toBe(
			"Fresh FAQ?",
		),
	);
	expect(page.querySelector(".faq-retry").hidden).toBe(true);
});

it.each([
	false,
	true,
])("requests the platform and caches the server response for offline use (%s)", async (isIOS) => {
	const platform = isIOS ? "ios" : "android";
	const key = `faqs:https://acode.app/api:${platform}`;
	const expected = [
		{ q: "Shared?", a: "Yes.", platform: "both" },
		{ q: "Storage?", a: "Platform instructions.", platform },
	];
	// Ignore the old unfiltered cache and a cache belonging to another platform.
	localStorage.setItem(
		"faqs:https://acode.app/api",
		JSON.stringify([{ q: "Old cache?", a: "Old." }]),
	);
	localStorage.setItem(
		`faqs:https://acode.app/api:${isIOS ? "android" : "ios"}`,
		JSON.stringify([{ q: "Other platform?", a: "Wrong." }]),
	);
	const fetch = vi.fn().mockResolvedValue(response(expected));
	const { page } = setup(fetch, strings, isIOS);
	expect(page.querySelectorAll("details")).toHaveLength(0);
	await vi.waitFor(() =>
		expect(page.querySelectorAll("details")).toHaveLength(expected.length),
	);
	expect(fetch).toHaveBeenCalledWith(
		`https://acode.app/api/faqs?platform=${platform}`,
		expect.any(Object),
	);
	expect(JSON.parse(localStorage.getItem(key))).toEqual(expected);
	page.hide();
	const offline = setup(
		vi.fn().mockRejectedValue(new Error("Offline")),
		strings,
		isIOS,
	).page;
	await vi.waitFor(() =>
		expect(offline.querySelectorAll("summary")).toHaveLength(expected.length),
	);
	expect(
		[...offline.querySelectorAll("summary")].map((item) =>
			item.textContent.trim(),
		),
	).toEqual(expected.map((faq) => faq.q));
});

function response(data) {
	return { ok: true, json: async () => data };
}
