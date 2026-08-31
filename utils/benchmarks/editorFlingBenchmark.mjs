#!/usr/bin/env node

import WebSocket from "ws";
import { analyzeCompositorFrame } from "./compositorFrameAnalysis.mjs";
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
const fixture = readOption("fixture", "javascript");
const speed = Number(readOption("speed", "12000"));
const distance = Number(readOption("distance", "6000"));

if ([port, cpuRate, runs, lineCount, speed, distance].some((value) => !Number.isFinite(value) || value <= 0)) {
	throw new Error("Invalid numeric benchmark option");
}
if (!editorFixtureNames.includes(fixture)) throw new Error(`Unknown fixture: ${fixture}`);

class DevToolsClient {
	constructor(url) {
		this.nextId = 1;
		this.pending = new Map();
		this.listeners = new Map();
		this.socket = new WebSocket(url);
	}

	async open() {
		await new Promise((resolve, reject) => {
			this.socket.once("open", resolve);
			this.socket.once("error", reject);
		});
		this.socket.on("message", (data) => {
			const message = JSON.parse(data.toString());
			if (message.method) {
				for (const listener of this.listeners.get(message.method) || []) {
					listener(message.params);
				}
				return;
			}
			const request = this.pending.get(message.id);
			if (!request) return;
			this.pending.delete(message.id);
			if (message.error) request.reject(new Error(message.error.message));
			else request.resolve(message.result);
		});
	}

	on(method, listener) {
		const listeners = this.listeners.get(method) || [];
		listeners.push(listener);
		this.listeners.set(method, listeners);
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

async function evaluate(client, expression, awaitPromise = true) {
	const result = await client.call("Runtime.evaluate", {
		expression,
		awaitPromise,
		returnByValue: true,
	});
	if (result.exceptionDetails) {
		throw new Error(
			result.exceptionDetails.exception?.description || result.exceptionDetails.text,
		);
	}
	return result.result.value;
}

async function dispatchTouchSwipe(client, setup, run) {
	const touchDistance = Math.min(distance, setup.scrollerHeight * 0.6);
	const scrollDirection = run % 2 ? -1 : 1;
	const startY = setup.y + scrollDirection * touchDistance / 2;
	const endY = setup.y - scrollDirection * touchDistance / 2;
	const duration = Math.max(48, touchDistance / speed * 1000);
	const steps = Math.max(3, Math.ceil(duration / 16));
	const point = (y) => ({
		x: setup.x,
		y,
		radiusX: 1,
		radiusY: 1,
		rotationAngle: 0,
		force: 1,
		id: 0,
	});
	await client.call("Input.dispatchTouchEvent", {
		type: "touchStart",
		touchPoints: [point(startY)],
	});
	for (let step = 1; step <= steps; step++) {
		await new Promise((resolve) => setTimeout(resolve, duration / steps));
		await client.call("Input.dispatchTouchEvent", {
			type: "touchMove",
			touchPoints: [point(startY + (endY - startY) * step / steps)],
		});
	}
	await client.call("Input.dispatchTouchEvent", {
		type: "touchEnd",
		touchPoints: [],
	});
	return { touchDistance, duration };
}

const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
const page = targets.find((target) => target.type === "page" && target.url?.includes("index.html"));
if (!page?.webSocketDebuggerUrl) throw new Error("No debuggable Acode page found");

const client = new DevToolsClient(page.webSocketDebuggerUrl);
await client.open();
const fixtureFactory = createEditorFixture.toString();

let activeScreencast = null;
let benchmarkError = null;
client.on("Page.screencastFrame", (params) => {
	client.call("Page.screencastFrameAck", { sessionId: params.sessionId }).catch(
		() => {},
	);
	if (activeScreencast) {
		activeScreencast.push({
			data: params.data,
			at: performance.now(),
		});
	}
});

let recoveryPromise = null;
const recover = () => recoveryPromise ??= (async () => {
	const recoveryErrors = [];
	activeScreencast = null;
	try {
		await cleanupRemoteEditorFixture(client, "__acodeFlingBenchmark", [
			"__acodeFlingSamples",
			"__acodeFlingStartTop",
			"__acodeFlingGeneration",
			"__acodeFlingStarted",
		]);
	} catch (error) {
		recoveryErrors.push(error);
	}
	try {
		await client.call("Page.stopScreencast");
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
	await client.call("Page.enable");
	await cleanupRemoteEditorFixture(client, "__acodeFlingBenchmark", [
		"__acodeFlingSamples",
		"__acodeFlingStartTop",
		"__acodeFlingGeneration",
		"__acodeFlingStarted",
	]);
	await client.call("Emulation.setCPUThrottlingRate", { rate: cpuRate });
	const setup = await evaluate(client, `
		(async () => {
			const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
			const waitFor = async (predicate) => {
				const started = performance.now();
				while (!predicate()) {
					if (performance.now() - started > 10000) throw new Error("Timed out waiting for Acode editor");
					await wait(50);
				}
			};
			await waitFor(() => window.editorManager?.editor && window.acode);
			const previousFile = window.editorManager.activeFile;
			const EditorFile = window.acode.require("editorFile");
			const fixture = (${fixtureFactory})(${JSON.stringify(fixture)}, ${lineCount});
			const file = new EditorFile(fixture.name, {
				text: fixture.text,
				render: true,
				isUnsaved: false,
				persistInSession: false,
			});
			window.__acodeFlingBenchmark = { file, previousFile };
			await waitFor(() => window.editorManager.activeFile?.id === file.id);
			await wait(1000);
			const scroller = window.editorManager.editor.scrollDOM;
			const rect = scroller.getBoundingClientRect();
			const contentRect = window.editorManager.editor.contentDOM.getBoundingClientRect();
			return {
				x: Math.round(rect.left + rect.width / 2),
				y: Math.round(rect.top + rect.height / 2),
				scrollerHeight: rect.height,
				viewportWidth: window.innerWidth,
				viewportHeight: window.innerHeight,
				contentRect: {
					left: contentRect.left,
					top: contentRect.top,
					width: contentRect.width,
					height: contentRect.height,
				},
				backgrounds: [
					getComputedStyle(window.editorManager.editor.contentDOM).backgroundColor,
					getComputedStyle(scroller).backgroundColor,
					getComputedStyle(window.editorManager.editor.dom).backgroundColor,
					getComputedStyle(document.body).backgroundColor,
				],
				touchAction: getComputedStyle(scroller).touchAction,
				controlledTouchScroll: window.editorManager.editor.state.facet(
					window.editorManager.editor.constructor.controlledTouchScroll,
				),
				controllerDebug: {
					present: !!window.editorManager.editor.controlledTouchScrollController,
					snapshotType: typeof window.editorManager.editor.controlledTouchScrollController?.debugSnapshot,
				},
				willChange: getComputedStyle(scroller).willChange,
				contentVisibility: getComputedStyle(scroller).contentVisibility,
			};
		})()
	`);
	await client.call("Page.startScreencast", {
		format: "jpeg",
		quality: 75,
		maxWidth: Math.ceil(setup.viewportWidth * 2),
		maxHeight: Math.ceil(setup.viewportHeight * 2),
		everyNthFrame: 1,
	});

	const measurements = [];
	for (let run = 0; run < runs; run++) {
		const prewarm = await evaluate(client, `
			(async () => {
				const view = window.editorManager.editor;
				const scroller = view.scrollDOM;
				const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
				scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) * 0.5;
				const started = performance.now();
				let previousTop = -1;
				let previousHeight = -1;
				let stableFrames = 0;
				while (stableFrames < 4) {
					await frame();
					const viewport = scroller.getBoundingClientRect();
					const hasVisibleText = Array.from(view.contentDOM.querySelectorAll(".cm-line")).some((line) => {
						const rect = line.getBoundingClientRect();
						return rect.bottom > viewport.top + 1 && rect.top < viewport.bottom - 1;
					});
					const stable = hasVisibleText && Math.abs(scroller.scrollTop - previousTop) < 1 &&
						Math.abs(scroller.scrollHeight - previousHeight) < 1;
					stableFrames = stable ? stableFrames + 1 : 0;
					previousTop = scroller.scrollTop;
					previousHeight = scroller.scrollHeight;
					if (performance.now() - started > 15000)
						throw new Error("Timed out waiting for a stable rendered viewport");
				}
				const prewarmStarted = performance.now();
				while (
					!view.controlledTouchScrollController?.debugSnapshot?.().idlePrewarmReady &&
					performance.now() - prewarmStarted < 5000
				) await frame();
				return {
					ready: !!view.controlledTouchScrollController?.debugSnapshot?.().idlePrewarmReady,
					waitMs: performance.now() - prewarmStarted,
				};
			})()
		`);
		const beforeGesture = await evaluate(
			client,
			"window.editorManager.editor.controlledTouchScrollController?.debugSnapshot?.() || null",
		);
		await evaluate(client, `
			(() => {
				const view = window.editorManager.editor;
				const scroller = view.scrollDOM;
				window.__acodeFlingSamples = [];
				window.__acodeFlingStartTop = scroller.scrollTop;
				const generation = window.__acodeFlingGeneration = (window.__acodeFlingGeneration || 0) + 1;
				const started = window.__acodeFlingStarted = performance.now();
				const sample = () => {
					if (window.__acodeFlingGeneration !== generation) return;
					const elapsed = performance.now() - started;
					const viewport = scroller.getBoundingClientRect();
					const lines = Array.from(view.contentDOM.querySelectorAll(".cm-line")).filter((line) => {
						const rect = line.getBoundingClientRect();
						return rect.bottom > viewport.top + 1 && rect.top < viewport.bottom - 1;
					});
					const momentum = view.controlledTouchScrollController?.debugSnapshot?.() || null;
					window.__acodeFlingSamples.push({
						at: elapsed,
						visibleLines: lines.length,
						highlightedLines: lines.filter((line) => line.querySelector("span[class]")).length,
						scrollTop: scroller.scrollTop,
						clientHeight: scroller.clientHeight,
						momentum,
					});
					if (elapsed < 10000 && (elapsed < 800 || momentum?.active || !momentum?.termination))
						requestAnimationFrame(sample);
				};
				requestAnimationFrame(sample);
			})()
		`, false);

		activeScreencast = [];
		const compositorStarted = performance.now();
		const dispatchedGesture = await dispatchTouchSwipe(client, setup, run);
		await evaluate(client, `
			(async () => {
				const started = performance.now();
				while (performance.now() - started < 5000) {
					const momentum = window.editorManager.editor.controlledTouchScrollController?.debugSnapshot?.();
					if (momentum?.termination && !momentum.active) break;
					await new Promise((resolve) => setTimeout(resolve, 25));
				}
				await new Promise((resolve) => setTimeout(resolve, 150));
			})()
		`);
		const finalController = await evaluate(
			client,
			"window.editorManager.editor.controlledTouchScrollController?.debugSnapshot?.() || null",
		);
		const compositorFrames = activeScreencast;
		activeScreencast = null;
		const compositorAnalysis = compositorFrames.map((frame) => ({
			at: frame.at - compositorStarted,
			...analyzeCompositorFrame(frame, setup),
		}));
		const samples = await evaluate(client, `
			(() => {
				const view = window.editorManager.editor;
				const scroller = view.scrollDOM;
				const viewport = scroller.getBoundingClientRect();
				const lines = Array.from(view.contentDOM.querySelectorAll(".cm-line")).filter((line) => {
					const rect = line.getBoundingClientRect();
					return rect.bottom > viewport.top + 1 && rect.top < viewport.bottom - 1;
				});
				const samples = window.__acodeFlingSamples || [];
				samples.push({
					at: performance.now() - window.__acodeFlingStarted,
					visibleLines: lines.length,
					highlightedLines: lines.filter((line) => line.querySelector("span[class]")).length,
					scrollTop: scroller.scrollTop,
					clientHeight: scroller.clientHeight,
					momentum: view.controlledTouchScrollController?.debugSnapshot?.() || null,
				});
				return samples;
			})()
		`);
		const startTop = await evaluate(client, "window.__acodeFlingStartTop");
		const lastSample = samples[samples.length - 1];
		const firstMovement = samples.find((sample) => Math.abs(sample.scrollTop - startTop) > 0.5);
		const momentumSamples = samples.filter((sample) => sample.momentum?.releaseVelocity);
		const firstMomentum = momentumSamples.find((sample) => sample.momentum.active);
		const sampledFinalMomentum = [...momentumSamples].reverse().find(
			(sample) => sample.momentum.termination,
		)?.momentum || momentumSamples.at(-1)?.momentum;
		const finalMomentum = finalController?.releaseVelocity
			? finalController
			: sampledFinalMomentum;
		const terminationSample = [...momentumSamples].reverse().find(
			(sample) => sample.momentum.termination && !sample.momentum.active,
		);
		let maximumAccelerationRatio = 0;
		let catchUpJumps = 0;
		for (let index = 1; index < momentumSamples.length; index++) {
			const previous = momentumSamples[index - 1];
			const current = momentumSamples[index];
			const previousVelocity = Math.abs(previous.momentum.currentVelocity);
			const currentVelocity = Math.abs(current.momentum.currentVelocity);
			if (previous.momentum.active && current.momentum.active && previousVelocity > 0)
				maximumAccelerationRatio = Math.max(
					maximumAccelerationRatio,
					(currentVelocity - previousVelocity) / previousVelocity,
				);
			const gap = current.at - previous.at;
			const step = Math.abs(current.scrollTop - previous.scrollTop);
			if (previous.momentum.active && gap > 40 && step > previousVelocity * 0.032 + 2)
				catchUpJumps++;
		}
		const expectedDistance = Math.abs(finalMomentum?.expectedDistance || 0);
		const expectedDuration = finalMomentum?.expectedDuration || 0;
		const completed = finalMomentum?.termination === "completed";
		const momentumDuration = finalMomentum?.actualDuration ||
			(firstMomentum && terminationSample
				? terminationSample.at - firstMomentum.at
				: null);
		measurements.push({
			run: run + 1,
			idlePrewarmReady: beforeGesture?.idlePrewarmReady ?? false,
			idlePrewarmWaitMs: prewarm.waitMs,
			frames: samples.length,
			blankFrames: samples.filter((sample) => sample.visibleLines === 0).length,
			plainFrames: samples.filter((sample) => sample.visibleLines > 0 && sample.highlightedLines === 0).length,
			plainAtEnd: !!lastSample && lastSample.visibleLines > 0 && lastSample.highlightedLines === 0,
			gestureResponseMs: firstMovement?.at ?? null,
			controllerFirstMovementMs: finalController?.firstMovementDelay ?? null,
			maxPreparationDurationMs: samples.reduce(
				(maximum, sample) => Math.max(
					maximum,
					sample.momentum?.preparationDuration || 0,
				),
				0,
			),
			minimumPreparationChunkScreens: samples.reduce(
				(minimum, sample) => Math.min(
					minimum,
					sample.momentum?.preparationChunkScreens ?? Infinity,
				),
				Infinity,
			),
			minimumRemainingSafeDistance: samples.reduce(
				(minimum, sample) => sample.momentum?.active
					? Math.min(minimum, sample.momentum.remainingSafeDistance)
					: minimum,
				Infinity,
			),
			touchDistance: dispatchedGesture.touchDistance,
			touchDurationMs: dispatchedGesture.duration,
			releaseVelocity: finalMomentum?.releaseVelocity ?? null,
			expectedMomentumDistance: expectedDistance || null,
			expectedMomentumDuration: expectedDuration || null,
			committedMomentumDistance: finalMomentum?.committedDistance ?? null,
			momentumDurationMs: momentumDuration,
			momentumTermination: finalMomentum?.termination ?? null,
			distanceErrorRatio: completed && expectedDistance
				? Math.abs(Math.abs(finalMomentum.committedDistance) - expectedDistance) / expectedDistance
				: null,
			durationErrorRatio: completed && expectedDuration && momentumDuration != null
				? Math.abs(momentumDuration - expectedDuration) / expectedDuration
				: null,
			maxPostReleaseAccelerationRatio: maximumAccelerationRatio,
			catchUpJumps,
			maxCorridorAheadScreens: momentumSamples.filter(
				(sample) => sample.momentum.active,
			).reduce(
				(maximum, sample) => {
					const prepared = sample.momentum.releaseVelocity < 0
						? (sample.scrollTop - sample.momentum.corridorFrom) / sample.clientHeight
						: (sample.momentum.corridorTo - sample.scrollTop - sample.clientHeight) /
							sample.clientHeight;
					return Math.max(maximum, prepared);
				},
				0,
			),
			scrollDistance: lastSample ? lastSample.scrollTop - startTop : 0,
			maxScrollStep: samples.reduce(
				(max, sample, index) => index
					? Math.max(max, Math.abs(sample.scrollTop - samples[index - 1].scrollTop))
					: max,
				0,
			),
			maxFrameGapMs: samples.reduce((max, sample, index) => index ? Math.max(max, sample.at - samples[index - 1].at) : max, 0),
			compositorFrames: compositorAnalysis.length,
			compositorBlankFrames: compositorAnalysis.filter((sample) => sample.blank).length,
			minNonBackgroundRatio: compositorAnalysis.reduce(
				(min, sample) => sample.nonBackgroundRatio == null
					? min
					: Math.min(min, sample.nonBackgroundRatio),
				Infinity,
			),
			maxCompositorFrameGapMs: compositorAnalysis.reduce(
				(max, sample, index) =>
					index
						? Math.max(max, sample.at - compositorAnalysis[index - 1].at)
						: max,
				0,
			),
		});
	}

	console.log(JSON.stringify({
		cpuRate,
		runs,
		fixture,
		lineCount,
		speed,
		distance,
		scrollerStyle: {
			touchAction: setup.touchAction,
			willChange: setup.willChange,
			contentVisibility: setup.contentVisibility,
		},
		controlledTouchScroll: setup.controlledTouchScroll,
		controllerDebug: setup.controllerDebug,
		measurements,
			summary: {
				idlePrewarmReadyRuns: measurements.filter(
					(item) => item.idlePrewarmReady,
				).length,
				maxIdlePrewarmWaitMs: Math.max(
					...measurements.map((item) => item.idlePrewarmWaitMs),
				),
				blankFrames: measurements.reduce((sum, item) => sum + item.blankFrames, 0),
				compositorBlankFrames: measurements.reduce(
					(sum, item) => sum + item.compositorBlankFrames,
					0,
				),
				missingCompositorRuns: measurements.filter(
					(item) => item.compositorFrames === 0,
				).length,
				plainFrames: measurements.reduce((sum, item) => sum + item.plainFrames, 0),
				plainAtEndRuns: measurements.filter((item) => item.plainAtEnd).length,
				catchUpJumps: measurements.reduce((sum, item) => sum + item.catchUpJumps, 0),
				momentumTerminations: Object.fromEntries(
					["completed", "edge", "render-limited", "cancelled"].map((reason) => [
						reason,
						measurements.filter((item) => item.momentumTermination === reason).length,
					]),
				),
				maxFrameGapMs: Math.max(...measurements.map((item) => item.maxFrameGapMs)),
				maxCompositorFrameGapMs: Math.max(
					...measurements.map((item) => item.maxCompositorFrameGapMs),
				),
			},
	}, null, 2));

} catch (error) {
	benchmarkError = error;
	throw error;
} finally {
	removeInterruptRecovery();
	const recoveryErrors = await recover();
	reportBenchmarkRecovery(benchmarkError, recoveryErrors);
}
