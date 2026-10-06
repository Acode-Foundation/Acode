// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import strings from "../../src/lang/en-us.json";
import { loadSourceModule } from "../helpers/loadSourceModule";

afterEach(() => vi.restoreAllMocks());

function setup() {
	let restored = false,
		pluginsReady = false;
	const open = vi.fn(async () => {});
	const select = vi.fn(async () => "close");
	const exec = vi.fn();
	const reportError = vi.fn();
	const handler = loadSourceModule(
		"src/handlers/intent.js",
		{
			fileSystem: {},
			"lib/auth": {},
			"lib/config": {},
			"lib/startAd": {},
			"lib/openFile": open,
			"lib/loadPlugins": { isInitialPluginLoadComplete: () => pluginsReady },
			"dialogs/select": select,
			"utils/helpers": { error: reportError },
		},
		{
			document,
			strings,
			acode: { exec },
			sessionStorage: { getItem: () => String(restored) },
		},
	);
	return {
		...handler,
		open,
		select,
		exec,
		reportError,
		ready(files = true, plugins = true) {
			restored = files;
			pluginsReady = plugins;
		},
		send(uris, action = "SEND_MULTIPLE") {
			return handler.default({
				action: `android.intent.action.${action}`,
				uris,
			});
		},
	};
}

it("queues cold-start and in-startup batches until both files and plugins are ready", async () => {
	const f = setup();
	await f.send(["content://docs/1"]);
	f.ready(true, false);
	await f.send(["content://docs/2"]);
	await f.processPendingIntents();
	expect(f.open).not.toHaveBeenCalled();
	f.ready(false, true);
	await f.processPendingIntents();
	expect(f.open).not.toHaveBeenCalled();
	f.ready();
	await f.processPendingIntents();
	expect(f.open.mock.calls.map(([uri]) => uri)).toEqual(["content://docs/1", "content://docs/2"]);
	expect(f.open).toHaveBeenLastCalledWith("content://docs/2", {
		mode: "single",
		render: true,
		persistInSession: false,
		external: true,
	});
});

it("serializes warm batches and deduplicates stream/ClipData URIs without losing order", async () => {
	const f = setup();
	f.ready();
	let finish;
	f.open.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	const first = f.send(["content://docs/1", "content://docs/1", "file:///second.pdf"]);
	const second = f.send(["content://docs/3"], "SEND");
	expect(f.open).toHaveBeenCalledTimes(1);
	finish();
	await Promise.all([first, second]);
	expect(f.open.mock.calls.map(([uri]) => uri)).toEqual([
		"content://docs/1",
		"file:///second.pdf",
		"content://docs/3",
	]);
});

it("accepts legacy single streams and VIEW/EDIT data and leaves deep links on their existing route", async () => {
	const f = setup();
	f.ready();
	await f.default({
		action: "android.intent.action.SEND",
		extras: { "android.intent.extra.STREAM": "content://docs/one" },
	});
	for (const action of ["VIEW", "EDIT"])
		await f.default({
			action: `android.intent.action.${action}`,
			data: "content://docs/opaque",
		});
	const link = vi.fn((event) => event.preventDefault());
	f.addIntentHandler(link);
	await f.default({
		action: "android.intent.action.VIEW",
		data: "acode://sample/open/id",
	});
	expect(link).toHaveBeenCalledWith(
		expect.objectContaining({ module: "sample", action: "open", value: "id" }),
	);
	f.removeIntentHandler(link);
	await f.default({
		action: "android.intent.action.VIEW",
		data: "acode://auth/callback",
	});
	await f.default({ action: "android.intent.action.MAIN" });
	expect(f.open).toHaveBeenCalledTimes(3);
	expect(f.select).not.toHaveBeenCalled();
});

it("continues after failures and offers Plugins once per batch, escaping provider names", async () => {
	const f = setup();
	f.ready();
	vi.spyOn(console, "error").mockImplementation(() => {});
	f.open.mockRejectedValueOnce({
		code: "DOCUMENT_HANDLER_UNAVAILABLE",
		filename: "<img src=x>.pdf",
	});
	f.open.mockRejectedValueOnce(new Error("Provider denied access"));
	f.select.mockResolvedValueOnce("plugins");
	await f.send([
		"content://docs/1",
		"content://docs/2",
		"content://docs/3",
		null,
		5,
		"https://not-a-file.test",
	]);
	expect(f.open).toHaveBeenCalledTimes(3);
	expect(f.select).toHaveBeenCalledOnce();
	const items = f.select.mock.calls[0][1];
	expect(items[0].text).toContain("&lt;img src=x&gt;.pdf");
	expect(items[0].text).toContain("content://docs/2");
	expect(items.map((item) => item.value)).toEqual([undefined, "plugins", "close"]);
	expect(f.exec).toHaveBeenCalledWith("open", "plugins");
});

it.each(["cancel", "reject"])(
	"continues queued and later intents when the error dialog ends with %s",
	async (outcome) => {
		const f = setup();
		f.ready();
		vi.spyOn(console, "error").mockImplementation(() => {});
		f.open.mockRejectedValueOnce({
			code: "DOCUMENT_HANDLER_UNAVAILABLE",
			filename: "missing.docx",
		});
		f.select.mockImplementationOnce((_title, _items, options) => {
			if (outcome === "reject") return Promise.reject(Error("Dialog failed"));
			options.onCancel();
			return new Promise(() => {});
		});
		await Promise.all([f.send(["content://docs/missing"]), f.send(["content://docs/queued"])]);
		await f.send(["content://docs/next"]);
		expect(f.open.mock.calls.map(([uri]) => uri)).toEqual([
			"content://docs/missing",
			"content://docs/queued",
			"content://docs/next",
		]);
		expect(f.reportError).toHaveBeenCalledTimes(outcome === "reject" ? 1 : 0);
		expect(f.exec).not.toHaveBeenCalled();
	},
);
