#!/usr/bin/env node

import WebSocket from "ws";
import {
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
const lineCount = Number(readOption("lines", "120000"));
const maxWait = Number(readOption("wait", "6000"));
const fixture = readOption("fixture", "javascript");
const includeMeasurements = readOption("details", "true") !== "false";
if (!editorFixtureNames.includes(fixture)) throw new Error(`Unknown fixture: ${fixture}`);

if (
	!Number.isFinite(port) ||
	!Number.isFinite(cpuRate) ||
	!Number.isFinite(runs) ||
	!Number.isFinite(lineCount) ||
	!Number.isFinite(maxWait) ||
	port <= 0 ||
	cpuRate < 1 ||
	runs < 1 ||
	lineCount < 1 ||
	maxWait < 1
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
			if (!message.id) return;
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
	if (!response.ok) {
		throw new Error(`DevTools endpoint returned ${response.status}`);
	}
	const targets = await response.json();
	const page = targets.find(
		(target) => target.type === "page" && target.url?.includes("index.html"),
	);
	if (!page?.webSocketDebuggerUrl) {
		throw new Error("No debuggable Acode page found");
	}
	return page;
}

function benchmarkExpression() {
	const options = JSON.stringify({ fixture, lineCount, runs, maxWait });
	const fixtureFactory = createEditorFixture.toString();
	return `
		(async () => {
			const options = ${options};
			const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
			const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
			const waitFor = async (predicate, timeout = 10000) => {
				const started = performance.now();
				while (!predicate()) {
					if (performance.now() - started > timeout) throw new Error("Timed out waiting for Acode editor");
					await wait(50);
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
			window.__acodeRenderingBenchmark = { file, previousFile };
			await waitFor(() => window.editorManager.activeFile?.id === file.id);
			await wait(1000);

			const view = window.editorManager.editor;
			const scroller = view.scrollDOM;
			const sample = () => {
				const viewport = scroller.getBoundingClientRect();
				const visibleLines = Array.from(view.contentDOM.querySelectorAll(".cm-line")).filter((line) => {
					const rect = line.getBoundingClientRect();
					return rect.bottom > viewport.top + 1 && rect.top < viewport.bottom - 1;
				});
				const highlightedLines = visibleLines.filter((line) => line.querySelector("span[class]")).length;
				return {
					visibleLines: visibleLines.length,
					highlightedLines,
					exact: language.syntaxTreeAvailable(view.state, view.viewport.to),
					viewportFrom: view.viewport.from,
					viewportTo: view.viewport.to,
					scrollTop: scroller.scrollTop,
				};
			};

			const scrollbars = async (ratio) => {
				scroller.dispatchEvent(new Event("scroll"));
				let scrollbar = null;
				for (let attempt = 0; attempt < 20 && !scrollbar; attempt++) {
					await frame();
					scrollbar = document.querySelector(".scrollbar-container.right");
				}
				if (typeof scrollbar?.onScroll !== "function") {
					throw new Error("Acode vertical scrollbar is not available");
				}
				scrollbar.onScroll(ratio);
			};

			const measureJump = async (ratio) => {
				const started = performance.now();
				await scrollbars(ratio);
				let blankFrames = 0;
				let textMs = null;
				let highlightMs = null;
				let exactMs = null;
				let current = sample();
				while (performance.now() - started < options.maxWait) {
					await frame();
					current = sample();
					const elapsed = performance.now() - started;
					if (current.visibleLines === 0) blankFrames++;
					else if (textMs == null) textMs = elapsed;
					if (current.highlightedLines > 0 && highlightMs == null) highlightMs = elapsed;
					if (current.exact && exactMs == null) exactMs = elapsed;
					if (textMs != null && highlightMs != null && exactMs != null) break;
				}
				return {
					ratio,
					blankFrames,
					textMs,
					highlightMs,
					exactMs,
					...current,
				};
			};

			const measurements = [];
			const targets = [0.05, 0.5, 0.95];
			for (let run = 0; run < options.runs; run++) {
				for (const ratio of run % 2 ? [...targets].reverse() : targets) {
					measurements.push({ run: run + 1, ...(await measureJump(ratio)) });
					await wait(40);
				}
			}

			const percentile = (values, percentage) => {
				if (!values.length) return null;
				const sorted = [...values].sort((a, b) => a - b);
				return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percentage) - 1)];
			};
			const values = (key) => measurements.map((item) => item[key]).filter(Number.isFinite);
			const result = {
				fixture: options.fixture,
				lineCount: view.state.doc.lines,
				documentLength: view.state.doc.length,
				scrollerStyle: {
					willChange: getComputedStyle(scroller).willChange,
					contentVisibility: getComputedStyle(scroller).contentVisibility,
				},
				summary: {
					blankFrames: measurements.reduce((sum, item) => sum + item.blankFrames, 0),
					textP95Ms: percentile(values("textMs"), 0.95),
					highlightP95Ms: percentile(values("highlightMs"), 0.95),
					exactP95Ms: percentile(values("exactMs"), 0.95),
					missingText: measurements.filter((item) => item.textMs == null).length,
					missingHighlight: measurements.filter((item) => item.highlightMs == null).length,
					missingExact: measurements.filter((item) => item.exactMs == null).length,
				},
			};
			if (${includeMeasurements}) result.measurements = measurements;

			return result;
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
		await cleanupRemoteEditorFixture(client, "__acodeRenderingBenchmark");
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
	await cleanupRemoteEditorFixture(client, "__acodeRenderingBenchmark");
	await client.call("Emulation.setCPUThrottlingRate", { rate: cpuRate });
	const evaluation = await client.call("Runtime.evaluate", {
		expression: benchmarkExpression(),
		awaitPromise: true,
		returnByValue: true,
	});
	if (evaluation.exceptionDetails) {
		throw new Error(
			evaluation.exceptionDetails.exception?.description ||
				evaluation.exceptionDetails.text,
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
