#!/usr/bin/env node

import { spawn } from "node:child_process";
// Standalone trusted-touch regression for published highlight coverage.
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { rspack } from "@rspack/core";
import WebSocket from "ws";

const root = fileURLToPath(new URL("../..", import.meta.url));
const require = createRequire(import.meta.url);
const option = (name, fallback) =>
	process.argv
		.find((arg) => arg.startsWith(`--${name}=`))
		?.slice(name.length + 3) ?? fallback;
const browser = option("browser", process.env.CHROME_BIN);
const cpu = Number(option("cpu", "4"));
const readOnlySelection = option("read-only-selection", "false") === "true";
const manualKeyboard = option("manual-keyboard", "false") === "true";
const focused = option("focused", "false") === "true";
const resizeDuringTouch = option("resize-during-touch", "false") === "true";
if (!browser || !Number.isFinite(cpu) || cpu < 1)
	throw new Error(
		"Usage: node utils/benchmarks/editorHighlightScrollSmoke.mjs --browser=/path/to/chromium --cpu=4",
	);
const directory = fs.mkdtempSync(
	path.join(os.tmpdir(), "acode-highlight-smoke-"),
);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let chrome, ws;
try {
	fs.writeFileSync(
		path.join(directory, "entry.ts"),
		`import {EditorState} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import {javascript} from '@codemirror/lang-javascript';
import {createEditorReadOnlyExtension} from ${JSON.stringify(path.join(root, "src/cm/editorReadOnly.ts"))};
import {createMainEditorExtensions} from ${JSON.stringify(path.join(root, "src/cm/mainEditorExtensions.ts"))};
import {syntaxHighlighting, defaultHighlightStyle, syntaxTree} from '@codemirror/language';
const doc = Array.from({length: 30000}, (_, i) => \`const value\${i} = {name: "text", count: \${i}}; // a highlighted line\`).join('\\n');
const view = new EditorView({parent: document.body, state: EditorState.create({doc, extensions: [javascript(), syntaxHighlighting(defaultHighlightStyle), ...createMainEditorExtensions(), createEditorReadOnlyExtension(${readOnlySelection})]})});
Object.assign(window, {view, frames: [], monitoring: false, sample() {
 const bounds = view.scrollDOM.getBoundingClientRect();
 const visible = [...document.querySelectorAll('.cm-line')].filter(line => {const r=line.getBoundingClientRect(); return r.bottom>bounds.top && r.top<bounds.bottom && line.textContent.trim()});
 return {top:view.scrollDOM.scrollTop, count:visible.length, plain:visible.filter(line => !line.querySelector('span[class]')).length, canonical:syntaxTree(view.state).length, viewport:view.viewport, parse:view[Symbol.for('@codemirror/language.viewportPriorityDebug')]?.()};
}});
function tick() {if(window.monitoring) window.frames.push(window.sample()); requestAnimationFrame(tick)}
requestAnimationFrame(tick);
`,
	);
	fs.writeFileSync(
		path.join(directory, "index.html"),
		`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden}body{user-select:none}.cm-editor{height:100%}.cm-scroller{font-size:14px;line-height:20px}</style><body><script defer src="app.js"></script>
`,
	);
	const config = require(path.join(root, "rspack.config.js"))(
		{},
		{ mode: "development" },
	)[0];
	config.entry = path.join(directory, "entry.ts");
	config.output = {
		...config.output,
		path: directory,
		filename: "app.js",
		clean: false,
	};
	config.resolve.modules = [
		path.join(root, "node_modules"),
		path.join(root, "src"),
	];
	const baseline = option("language-runtime");
	if (baseline)
		config.resolve.alias = { "@codemirror/language$": path.resolve(baseline) };
	const viewBaseline = option("view-runtime");
	if (viewBaseline)
		config.resolve.alias = {
			...config.resolve.alias,
			"@codemirror/view$": path.resolve(viewBaseline),
		};
	config.plugins = [];
	await new Promise((resolve, reject) => {
		const compiler = rspack(config);
		compiler.run((error, stats) =>
			compiler.close((closeError) => {
				if (error || closeError || stats.hasErrors())
					reject(
						error ||
							closeError ||
							new Error(stats.toString({ all: false, errors: true })),
					);
				else resolve();
			}),
		);
	});
	const profile = path.join(directory, "profile");
	chrome = spawn(
		browser,
		[
			"--no-sandbox",
			"--disable-gpu",
			"--remote-debugging-port=0",
			`--user-data-dir=${profile}`,
			"--allow-file-access-from-files",
			"about:blank",
		],
		{ stdio: "ignore" },
	);
	let launchError;
	chrome.on("error", (error) => {
		launchError = error;
	});
	let port;
	for (let i = 0; i < 100; i++) {
		await sleep(100);
		if (launchError) throw launchError;
		if (fs.existsSync(path.join(profile, "DevToolsActivePort"))) {
			port = fs
				.readFileSync(path.join(profile, "DevToolsActivePort"), "utf8")
				.split("\n")[0];
			break;
		}
	}
	if (!port) throw new Error("Browser did not open a debugging port");
	const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
	if (!targets[0]) throw new Error("Browser did not create an initial tab");
	ws = new WebSocket(targets[0].webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		ws.once("open", resolve);
		ws.once("error", reject);
	});
	let sequence = 0;
	const pending = new Map(),
		errors = [];
	ws.on("message", (data) => {
		const message = JSON.parse(data);
		if (message.id) {
			const request = pending.get(message.id);
			if (!request) return;
			pending.delete(message.id);
			clearTimeout(request.timer);
			if (message.error)
				request.reject(new Error(JSON.stringify(message.error)));
			else request.resolve(message.result);
		} else if (message.method === "Runtime.exceptionThrown")
			errors.push(message.params);
	});
	const send = (method, params = {}) =>
		new Promise((resolve, reject) => {
			const id = ++sequence;
			const timer = setTimeout(() => {
				pending.delete(id);
				reject(new Error(`Timed out: ${method}`));
			}, 15000);
			pending.set(id, { resolve, reject, timer });
			ws.send(JSON.stringify({ id, method, params }));
		});
	const evaluate = async (expression) => {
		const result = await send("Runtime.evaluate", {
			expression,
			returnByValue: true,
			awaitPromise: true,
		});
		if (result.exceptionDetails)
			throw new Error(JSON.stringify(result.exceptionDetails));
		return result.result.value;
	};
	await send("Runtime.enable");
	await send("Emulation.setDeviceMetricsOverride", {
		width: 412,
		height: 720,
		deviceScaleFactor: 1,
		mobile: true,
	});
	await send("Emulation.setTouchEmulationEnabled", { enabled: true });
	await send("Emulation.setUserAgentOverride", {
		userAgent:
			"Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36",
	});
	await send("Emulation.setCPUThrottlingRate", { rate: cpu });
	await send("Page.navigate", {
		url: pathToFileURL(path.join(directory, "index.html")).href,
	});
	for (let i = 0; i < 100; i++) {
		await sleep(50);
		if (await evaluate("!!window.view")) break;
	}
	await evaluate(`window.focusCalls = window.blurCalls = window.keyboardRequests = 0;
  if (navigator.virtualKeyboard) {
    const show = navigator.virtualKeyboard.show.bind(navigator.virtualKeyboard);
    navigator.virtualKeyboard.show = () => {window.keyboardRequests++; show()};
  }
  ${focused ? "view.focus();" : ""}
  for (const method of ["focus", "blur"]) {
    const original = view.contentDOM[method].bind(view.contentDOM);
    view.contentDOM[method] = (...args) => {window[method + "Calls"]++; return original(...args)};
  }
  view.scrollDOM.scrollTop = view.scrollDOM.scrollHeight / 2;`);
	await sleep(800);
	const initial = await evaluate("sample()");
	if (
		!initial.count ||
		!initial.top ||
		initial.canonical >= initial.viewport.from
	)
		throw new Error(
			"Fixture must show a mid-document viewport beyond canonical parsing",
		);
	await evaluate(`monitoring = true; window.touchClicks = 0;
    view.contentDOM.addEventListener("click", () => window.touchClicks++);`);
	const dragDistances = [];
	const resize = (height) =>
		send("Emulation.setDeviceMetricsOverride", {
			width: 412,
			height,
			deviceScaleFactor: 1,
			mobile: true,
		});
	for (let gesture = 0; gesture < 10; gesture++) {
		if (resizeDuringTouch) {
			await resize(720);
			await sleep(50);
		}
		const beforeDrag = await evaluate("view.scrollDOM.scrollTop");
		const direction = gesture < 7 ? 1 : -1,
			start = direction > 0 ? 620 : 100;
		await send("Input.dispatchTouchEvent", {
			type: "touchStart",
			touchPoints: [{ x: 220, y: start }],
		});
		if (resizeDuringTouch) {
			await resize(780);
			await sleep(50);
		}
		for (let step = 1; step <= 10; step++) {
			if (resizeDuringTouch && step === 5) {
				await resize(840);
				await sleep(50);
			}
			await sleep(16);
			await send("Input.dispatchTouchEvent", {
				type: "touchMove",
				touchPoints: [{ x: 220, y: start - direction * step * 48 }],
			});
		}
		dragDistances.push(
			(await evaluate("view.scrollDOM.scrollTop")) - beforeDrag,
		);
		await send("Input.dispatchTouchEvent", {
			type: "touchEnd",
			touchPoints: [],
		});
		await sleep(250);
	}
	await sleep(500);
	const result = await evaluate(`monitoring = false; ({frames: frames.length,
 plainFrames: frames.filter(frame => frame.plain > 0).length,
 blankFrames: frames.filter(frame => !frame.count).length,
 keyboardRequests, keyboardPolicy: view.contentDOM.getAttribute("virtualkeyboardpolicy"), focusCalls, blurCalls, touchClicks, focused: view.hasFocus, last: sample()})`);
	if (readOnlySelection) {
		const before = await evaluate("view.state.doc.toString()");
		await send("Input.dispatchMouseEvent", {
			type: "mousePressed",
			x: 70,
			y: 300,
			button: "left",
			buttons: 1,
			clickCount: 1,
		});
		for (let step = 1; step <= 8; step++) {
			await send("Input.dispatchMouseEvent", {
				type: "mouseMoved",
				x: 70 + step * 18,
				y: 300 + step * 5,
				button: "left",
				buttons: 1,
			});
		}
		await send("Input.dispatchMouseEvent", {
			type: "mouseReleased",
			x: 214,
			y: 340,
			button: "left",
			buttons: 0,
			clickCount: 1,
		});
		await sleep(100);
		result.readOnlySelection =
			await evaluate(`({text: document.getSelection().toString(),
      stateSelection: view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to),
      selectable: getComputedStyle(view.contentDOM).userSelect,
      editable: view.contentDOM.contentEditable, keyboardRequests})`);
		if (
			!result.readOnlySelection.text ||
			result.readOnlySelection.text !==
				result.readOnlySelection.stateSelection ||
			result.readOnlySelection.selectable !== "text" ||
			result.readOnlySelection.editable !== "false" ||
			result.readOnlySelection.keyboardRequests ||
			before !== (await evaluate("view.state.doc.toString()"))
		)
			throw new Error(
				"Read-only text selection failed: " +
					JSON.stringify(result.readOnlySelection),
			);
	}
	if (manualKeyboard) {
		await send("Input.dispatchTouchEvent", {
			type: "touchStart",
			touchPoints: [{ x: 220, y: 300 }],
		});
		if ((await evaluate("keyboardRequests")) !== 0)
			throw new Error("Finger-down requested the keyboard");
		await send("Input.dispatchTouchEvent", {
			type: "touchEnd",
			touchPoints: [],
		});
		await sleep(100);
		result.tapKeyboardRequests = await evaluate("keyboardRequests");
	}
	console.log(
		JSON.stringify(
			{ cpu, resizeDuringTouch, dragDistances, initial, ...result, errors },
			null,
			2,
		),
	);
	if (
		errors.length ||
		(manualKeyboard &&
			(result.keyboardPolicy !== "manual" ||
				result.keyboardRequests !== 0 ||
				result.tapKeyboardRequests !== 1)) ||
		result.touchClicks ||
		(resizeDuringTouch &&
			dragDistances.some((distance) => Math.abs(distance) < 400)) ||
		result.focusCalls ||
		result.blurCalls ||
		(focused && !result.focused) ||
		result.plainFrames ||
		result.blankFrames ||
		!result.frames ||
		result.last.top === initial.top
	)
		process.exitCode = 1;
} finally {
	ws?.close();
	if (chrome && chrome.exitCode === null && chrome.pid) {
		await new Promise((resolve) => {
			chrome.once("exit", resolve);
			chrome.kill();
		});
	}
	fs.rmSync(directory, { recursive: true, force: true });
}
