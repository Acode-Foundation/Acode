#!/usr/bin/env node

import WebSocket from "ws";
import {
	cleanupEditorFixture,
	cleanupRemoteEditorFixture,
	createEditorFixture,
	editorFixtureNames,
	installBenchmarkInterruptRecovery,
	reportBenchmarkRecovery,
} from "./editorFixtures.mjs";

function readOption(name, fallback) {
	const prefix = `--${name}=`;
	const argument = process.argv.find((value) => value.startsWith(prefix));
	return argument ? argument.slice(prefix.length) : fallback;
}

const port = Number(readOption("port", "9222"));
const cpuRate = Number(readOption("cpu", "1"));
const runs = Number(readOption("runs", "10"));
const edits = Number(readOption("edits", "10"));
const interval = Number(readOption("interval", "75"));
const lineCount = Number(readOption("lines", "120000"));
const maxWait = Number(readOption("wait", "5000"));
const fixture = readOption("fixture", "javascript");
const includeMeasurements = readOption("details", "true") !== "false";

if (!editorFixtureNames.includes(fixture)) throw new Error(`Unknown fixture: ${fixture}`);
if (
	![port, cpuRate, runs, edits, interval, lineCount, maxWait].every(Number.isFinite) ||
	port <= 0 || cpuRate < 1 || runs < 1 || edits < 1 || interval < 1 ||
	lineCount < 1 || maxWait < 1
) {
	throw new Error("Invalid numeric benchmark option");
}

class DevToolsClient {
	constructor(url) {
		this.nextId = 1;
		this.pending = new Map();
		this.socket = new WebSocket(url);
	}

	async open() {
		await new Promise((resolve, reject) => {
			this.socket.once("open", resolve);
			this.socket.once("error", reject);
		});
		this.socket.on("message", (data) => {
			const message = JSON.parse(data.toString());
			const request = this.pending.get(message.id);
			if (!request) return;
			this.pending.delete(message.id);
			if (message.error) request.reject(new Error(message.error.message));
			else request.resolve(message.result);
		});
	}

	call(method, params = {}) {
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			this.socket.send(JSON.stringify({ id, method, params }));
		});
	}

	close() {
		this.socket.close();
	}
}

async function findPage() {
	const response = await fetch(`http://127.0.0.1:${port}/json/list`);
	if (!response.ok) throw new Error(`DevTools endpoint returned ${response.status}`);
	const targets = await response.json();
	const page = targets.find(
		(target) => target.type === "page" && target.url?.includes("index.html"),
	);
	if (!page?.webSocketDebuggerUrl) throw new Error("No debuggable Acode page found");
	return page;
}

function benchmarkExpression() {
	const options = JSON.stringify({ fixture, lineCount, runs, edits, interval, maxWait });
	const fixtureFactory = createEditorFixture.toString();
	const fixtureCleanup = cleanupEditorFixture.toString();
	return `
		(async () => {
			const options = ${options};
			const cleanupEditorFixture = (${fixtureCleanup});
			const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
			const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
			const waitFor = async (predicate, timeout = 10000) => {
				const started = performance.now();
				while (!predicate()) {
					if (performance.now() - started > timeout) throw new Error("Timed out waiting for editor state");
					await wait(25);
				}
			};

			await waitFor(() => window.editorManager?.editor && window.acode);
			const previousFile = window.editorManager.activeFile;
			const EditorFile = window.acode.require("editorFile");
			const language = window.acode.require("@codemirror/language");
			const fixture = (${fixtureFactory})(options.fixture, options.lineCount);
			const file = new EditorFile(fixture.name, {
				text: fixture.text,
				render: true,
				isUnsaved: false,
				persistInSession: false,
			});
			window.__acodeEditHighlightBenchmark = { file, previousFile };

			let benchmarkError = null;
			try {
				await waitFor(() => window.editorManager.activeFile?.id === file.id);
				await wait(1000);
				const view = window.editorManager.editor;
				const scroller = view.scrollDOM;
				const debugSymbol = Symbol.for("@codemirror/language.viewportPriorityDebug");
				const sample = () => {
					const viewport = scroller.getBoundingClientRect();
					const visible = Array.from(view.contentDOM.querySelectorAll(".cm-line")).filter((line) => {
						const rect = line.getBoundingClientRect();
						return rect.bottom > viewport.top + 1 && rect.top < viewport.bottom - 1;
					});
					const colored = visible.filter((line) => line.querySelector("span[class]")).length;
					return {
						at: performance.now(),
						visible: visible.length,
						colored,
						coloredRatio: visible.length ? colored / visible.length : 0,
						exact: language.syntaxTreeAvailable(view.state, view.viewport.to),
						parse: view[debugSymbol]?.() || null,
					};
				};

				scroller.dispatchEvent(new Event("scroll"));
				let scrollbar = null;
				for (let attempt = 0; attempt < 20 && !scrollbar; attempt++) {
					await frame();
					scrollbar = document.querySelector(".scrollbar-container.right");
				}
				if (typeof scrollbar?.onScroll !== "function")
					throw new Error("Acode vertical scrollbar is not available");
				scrollbar.onScroll(0.5);
				await waitFor(() => sample().colored > 0, options.maxWait);

				const measurements = [];
				for (let run = 0; run < options.runs; run++) {
					const editSamples = [];
					for (let edit = 0; edit < options.edits; edit++) {
						const line = view.state.doc.lineAt(Math.max(1, view.viewport.from));
						const position = Math.min(line.to, line.from + 6);
						const before = sample();
						const dispatchStarted = performance.now();
						view.dispatch({
							changes: { from: position, insert: "x" },
							selection: { anchor: position + 1 },
							userEvent: "input.type",
						});
						const dispatchMs = performance.now() - dispatchStarted;
						const frames = [{ phase: "immediate", ...sample() }];
						const until = performance.now() + options.interval;
						while (performance.now() < until) {
							await frame();
							frames.push({ phase: "frame", ...sample() });
						}
						editSamples.push({ edit: edit + 1, dispatchMs, before, frames });
					}

					const idleStarted = performance.now();
					while (!sample().exact && performance.now() - idleStarted < options.maxWait)
						await wait(25);
					const final = sample();
					const frames = editSamples.flatMap((entry) => entry.frames);
					const generations = editSamples.flatMap((entry) => [
						entry.before.parse?.generation,
						...entry.frames.map((item) => item.parse?.generation),
					]).filter(Number.isFinite);
					measurements.push({
						run: run + 1,
						plainFrames: frames.filter((item) => item.visible > 0 && item.colored === 0).length,
						plainEdits: editSamples.filter((entry) => entry.frames.some(
							(item) => item.visible > 0 && item.colored === 0,
						)).map((entry) => entry.edit),
						plainBeforeEdits: editSamples.filter(
							(entry) => entry.before.visible > 0 && entry.before.colored === 0,
						).map((entry) => entry.edit),
						minimumColoredRatio: frames.reduce(
							(minimum, item) => item.visible ? Math.min(minimum, item.coloredRatio) : minimum,
							1,
						),
						maximumDispatchMs: Math.max(...editSamples.map((item) => item.dispatchMs)),
						generationDelta: generations.length
							? Math.max(...generations) - Math.min(...generations)
							: null,
						exactAfterIdle: final.exact,
						exactHandoffMs: final.exact ? final.at - idleStarted : null,
						finalParse: final.parse,
						editSamples,
					});
				}

				const result = {
					fixture: options.fixture,
					lineCount: view.state.doc.lines,
					runs: measurements.map((item) => ({
						run: item.run,
						plainFrames: item.plainFrames,
						plainEdits: item.plainEdits,
						plainBeforeEdits: item.plainBeforeEdits,
						minimumColoredRatio: item.minimumColoredRatio,
						maximumDispatchMs: item.maximumDispatchMs,
						generationDelta: item.generationDelta,
						exactAfterIdle: item.exactAfterIdle,
						finalParse: item.finalParse,
						...(${includeMeasurements} ? {edits: item.editSamples.map((entry) => ({
							edit: entry.edit,
							beforeRatio: entry.before.coloredRatio,
							minimumRatio: entry.frames.reduce(
								(minimum, frame) => Math.min(minimum, frame.coloredRatio),
								1,
							),
							beforeParse: entry.before.parse,
							immediateParse: entry.frames[0]?.parse || null,
							finalParse: entry.frames.at(-1)?.parse || null,
						}))} : {}),
					})),
					summary: {
						plainFrames: measurements.reduce((sum, item) => sum + item.plainFrames, 0),
						minimumColoredRatio: Math.min(...measurements.map((item) => item.minimumColoredRatio)),
						maximumDispatchMs: Math.max(...measurements.map((item) => item.maximumDispatchMs)),
						missingExactHandoffs: measurements.filter((item) => !item.exactAfterIdle).length,
					},
				};
				if (${includeMeasurements}) result.measurements = measurements;
				return result;
			} catch (error) {
				benchmarkError = error;
				throw error;
			} finally {
				try {
					await cleanupEditorFixture(window.__acodeEditHighlightBenchmark, window.editorManager);
				} catch (cleanupError) {
					if (benchmarkError) console.error("Benchmark fixture cleanup failed:", cleanupError);
					else throw cleanupError;
				} finally {
					delete window.__acodeEditHighlightBenchmark;
				}
			}
		})()
	`;
}

const page = await findPage();
const client = new DevToolsClient(page.webSocketDebuggerUrl);
await client.open();

let benchmarkError = null;
let recoveryPromise = null;
const recover = () => recoveryPromise ??= (async () => {
	const recoveryErrors = [];
	try {
		await cleanupRemoteEditorFixture(client, "__acodeEditHighlightBenchmark");
	} catch (error) {
		recoveryErrors.push(error);
	}
	try {
		await client.call("Emulation.setCPUThrottlingRate", { rate: 1 });
	} catch (error) {
		recoveryErrors.push(error);
	}
	client.close();
	return recoveryErrors;
})();
const removeInterruptRecovery = installBenchmarkInterruptRecovery(
	async (signal) => {
		const recoveryErrors = await recover();
		reportBenchmarkRecovery(new Error(`Benchmark interrupted by ${signal}`), recoveryErrors);
	},
);
try {
	await client.call("Runtime.enable");
	await cleanupRemoteEditorFixture(client, "__acodeEditHighlightBenchmark");
	await client.call("Emulation.setCPUThrottlingRate", { rate: cpuRate });
	const evaluation = await client.call("Runtime.evaluate", {
		expression: benchmarkExpression(),
		awaitPromise: true,
		returnByValue: true,
	});
	if (evaluation.exceptionDetails) {
		throw new Error(
			evaluation.exceptionDetails.exception?.description || evaluation.exceptionDetails.text,
		);
	}
	console.log(JSON.stringify({ cpuRate, ...evaluation.result.value }, null, 2));
} catch (error) {
	benchmarkError = error;
	throw error;
} finally {
	removeInterruptRecovery();
	const recoveryErrors = await recover();
	reportBenchmarkRecovery(benchmarkError, recoveryErrors);
}
