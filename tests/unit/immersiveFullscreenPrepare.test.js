import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const prepare = require("../../hooks/immersive-fullscreen.js");
const cordovaSource = fs.readFileSync(
	new URL(
		"../../node_modules/cordova-android/framework/src/org/apache/cordova/CordovaWebViewImpl.java",
		import.meta.url,
	),
	"utf8",
);
const controllerSource = fs.readFileSync(
	new URL("../../hooks/android/ImmersiveFullscreen.java", import.meta.url),
	"utf8",
);
const roots = [];

afterEach(() => {
	for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture(source = cordovaSource) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "acode-fullscreen-"));
	roots.push(root);
	const native = path.join(root, "platforms/android/CordovaLib/src/org/apache/cordova");
	const tracked = path.join(root, "hooks/android/ImmersiveFullscreen.java");
	const generated = path.join(native, "ImmersiveFullscreen.java");
	const webview = path.join(native, "CordovaWebViewImpl.java");
	fs.mkdirSync(native, { recursive: true });
	fs.mkdirSync(path.dirname(tracked), { recursive: true });
	fs.writeFileSync(tracked, controllerSource);
	fs.writeFileSync(webview, source);
	return {
		tracked,
		generated,
		webview,
		run: () => prepare({ opts: { projectRoot: root, platforms: ["android"] } }),
		read: () => fs.readFileSync(webview, "utf8"),
	};
}

describe("Android immersive fullscreen preparation", () => {
	it("wires fullscreen and orientation into the Cordova lifecycle in order", () => {
		const f = fixture();
		f.run();
		const patched = f.read();
		expect(fs.readFileSync(f.generated, "utf8")).toBe(controllerSource);
		for (const [method, before, after] of [
			["showCustomView", "parent.bringToFront()", "immersiveFullscreen.enter(wrapperView)"],
			["hideCustomView", "immersiveFullscreen.exit()", "mCustomViewCallback.onCustomViewHidden()"],
			["handlePause", "immersiveFullscreen.pause()", "pluginManager.onPause"],
			["handleResume", "immersiveFullscreen.resume()", "pluginManager.onResume"],
			["onPageStarted", "immersiveFullscreen.unlockOrientation()", "pluginManager.onReset"],
			["handleDestroy", "hideCustomView()", "engine.destroy()"],
		]) {
			const start = patched.indexOf(`public void ${method}(`);
			expect(start).toBeGreaterThan(-1);
			const body = patched.slice(start).split("\n    }", 1)[0];
			expect(body.indexOf(before)).toBeGreaterThan(-1);
			expect(body.indexOf(after)).toBeGreaterThan(body.indexOf(before));
		}
		const keyUp = patched.indexOf("event.getAction() == KeyEvent.ACTION_UP");
		const backEvent = patched.indexOf("fullscreenbackbutton");
		expect(backEvent).toBeGreaterThan(keyUp);
		expect(backEvent).toBeLessThan(patched.indexOf("hideCustomView();", keyUp));
	});

	it("is repeatable and refreshes the controller without altering upstream code", () => {
		const f = fixture();
		f.run();
		const first = f.read();
		fs.appendFileSync(f.tracked, "\n// updated native controller\n");
		f.run();
		expect(f.read()).toBe(first);
		expect(fs.readFileSync(f.generated, "utf8")).toBe(fs.readFileSync(f.tracked, "utf8"));
		expect(
			first.replace(
				/^[ \t]*\/\/ ACODE_FULLSCREEN_BEGIN ([a-z]+)\n[\s\S]*?^[ \t]*\/\/ ACODE_FULLSCREEN_END \1\n/gm,
				"",
			),
		).toBe(cordovaSource);
	});

	it("accepts the existing Java hook's formatting and retains CRLF", async () => {
		const formatted = await require("prettier").format(cordovaSource, {
			plugins: [require.resolve("prettier-plugin-java")],
			parser: "java",
			tabWidth: 2,
			printWidth: Number.POSITIVE_INFINITY,
			endOfLine: "crlf",
		});
		const f = fixture(formatted);
		f.run();
		const first = f.read();
		expect(first).toContain("\r\n");
		expect(first.replace(/\r\n/g, "")).not.toContain("\n");
		f.run();
		expect(f.read()).toBe(first);
	});

	it.each([
		["missing", cordovaSource.replace("parent.bringToFront();", "")],
		["ambiguous", `${cordovaSource}\nparent.bringToFront();\n`],
		...[
			"if (isBackButton && mCustomView != null)",
			"pluginManager.onPause(keepRunning);",
			"this.pluginManager.onResume(keepRunning);",
			"pluginManager.onReset();",
		].map((anchor) => [anchor, cordovaSource.replaceAll(anchor, "// changed upstream")]),
	])("rejects incompatible anchors before writing: %s", (_kind, source) => {
		const f = fixture(source);
		expect(f.run).toThrow(/Acode fullscreen: expected one Cordova/);
		expect(f.read()).toBe(source);
		expect(fs.existsSync(f.generated)).toBe(false);
	});

	it("rejects a damaged prior patch without overwriting either generated file", () => {
		const f = fixture();
		f.run();
		const damaged = f.read().replace("// ACODE_FULLSCREEN_END enter", "// missing end marker");
		fs.writeFileSync(f.webview, damaged);
		fs.writeFileSync(f.generated, "// existing controller");
		expect(f.run).toThrow(/incomplete generated patch/);
		expect(f.read()).toBe(damaged);
		expect(fs.readFileSync(f.generated, "utf8")).toBe("// existing controller");
	});
});
