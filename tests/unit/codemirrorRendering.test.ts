// @vitest-environment happy-dom

import { EditorState } from "@codemirror/state";
import { __test, EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";

function touchEvent(type: string, x: number, y: number, touchCount = 1) {
	const event = new Event(type, { bubbles: true, cancelable: true });
	Object.defineProperty(event, "touches", {
		value: Array.from({ length: touchCount }, () => ({ clientX: x, clientY: y })),
	});
	return event;
}

function controlledScrollHarness(
	bounds = { from: 0, to: 1200 },
	options: {
		autoCover?: boolean;
		prepareMs?: number;
		scrollHeight?: number;
		maxAhead?: number;
		startTop?: number;
	} = {},
) {
	const scrollDOM = document.createElement("div");
	const contentDOM = document.createElement("div");
	scrollDOM.append(contentDOM);
	const log: string[] = [];
	let scrollTop = options.startTop ?? 500;
	let now = 0;
	let nextFrame = 1;
	const frames = new Map<number, FrameRequestCallback>();
	let corridorActive = false;

	Object.defineProperties(scrollDOM, {
		clientHeight: { value: 600 },
		scrollHeight: { value: options.scrollHeight ?? 3000 },
		scrollTop: {
			get: () => scrollTop,
			set: (value: number) => {
				scrollTop = value;
				log.push(`scroll:${value}`);
			},
		},
		scrollTo: {
			value: ({ top, behavior }: ScrollToOptions) => {
				if (typeof top === "number") scrollTop = top;
				log.push(`${behavior}:${top}`);
			},
		},
	});

	const state = EditorState.create({
		extensions: [
			EditorView.controlledTouchScroll.of({
				maxAhead: options.maxAhead ?? 4,
				settleDelay: 120,
			}),
		],
	});
	const fakeWindow = {
		performance: { now: () => now },
		requestAnimationFrame(callback: FrameRequestCallback) {
			const id = nextFrame++;
			frames.set(id, callback);
			return id;
		},
		cancelAnimationFrame(id: number) {
			frames.delete(id);
		},
		addEventListener() {},
		removeEventListener() {},
	};
	const viewState = {
		scaleY: 1,
		get controlledScrollActive() {
			return corridorActive;
		},
		setControlledScrollCorridor(from: number, to: number) {
			corridorActive = true;
			log.push(`corridor:${from}:${to}`);
			if (options.autoCover) {
				bounds.from = Math.max(0, Math.min(bounds.from, from));
				bounds.to = Math.max(
					bounds.to,
					Math.min(
						(options.scrollHeight ?? 3000) - 600,
						Math.floor(to - 602),
					),
				);
			}
			return true;
		},
		clearControlledScrollCorridor() {
			const changed = corridorActive;
			corridorActive = false;
			return changed;
		},
		controlledScrollBounds: () => bounds,
	};
	const view = {
		state,
		scrollDOM,
		contentDOM,
		win: fakeWindow,
		viewState,
		dispatch() {
			log.push("dispatch");
		},
		requestMeasure(request?: {
			read: () => unknown;
			write?: (value: unknown) => void;
		}) {
			if (!request) return;
			log.push("render");
			const measured = request.read();
			now += options.prepareMs ?? 0;
			log.push("dom");
			request.write?.(measured);
		},
	};
	const Controller = __test.ControlledTouchScroll as unknown as new (
		view: unknown,
		supported: boolean,
	) => {
		destroy(): void;
		onScrollChanged(): boolean;
		clampToRenderedOffset(target: number): number;
		onHighlightCoverageReady(): void;
		onHighlightCoverageInvalidated(): void;
		debugSnapshot(): {
			active: boolean;
			releaseVelocity: number;
			expectedDistance: number;
			expectedDuration: number;
			actualDuration: number;
			currentVelocity: number;
			committedDistance: number;
			termination: string | null;
			corridorFrom: number;
			corridorTo: number;
			idlePrewarmReady: boolean;
			preparationDuration: number;
			preparationChunkScreens: number;
			firstMovementDelay: number;
			remainingSafeDistance: number;
		};
	};
	const controller = new Controller(view, true);

	return {
		controller,
		log,
		scrollDOM,
		contentDOM,
		get scrollTop() {
			return scrollTop;
		},
		runFrame(elapsed = 16) {
			const pending = [...frames.values()];
			frames.clear();
			now += elapsed;
			for (const callback of pending) callback(now);
		},
		get frameCount() {
			return frames.size;
		},
	};
}

function startMomentum(harness: ReturnType<typeof controlledScrollHarness>) {
	harness.scrollDOM.dispatchEvent(touchEvent("touchstart", 100, 500));
	harness.scrollDOM.dispatchEvent(touchEvent("touchmove", 100, 400));
	harness.runFrame();
	harness.scrollDOM.dispatchEvent(touchEvent("touchmove", 100, 300));
	harness.runFrame();
	harness.scrollDOM.dispatchEvent(touchEvent("touchend", 100, 300, 0));
	harness.runFrame();
}

describe("vendored CodeMirror rendering interfaces", () => {
	it("caps directional buffering and normalizes its settle delay", () => {
		const state = EditorState.create({
			extensions: [
				EditorView.viewportBuffer.of({ maxAhead: 20, settleDelay: -10 }),
			],
		});
		const config = state.facet(EditorView.viewportBuffer);

		expect(config).toEqual({ maxAhead: 4, settleDelay: 0 });
	});

	it("caps controlled touch scrolling and normalizes its settle delay", () => {
		const state = EditorState.create({
			extensions: [
				EditorView.controlledTouchScroll.of({ maxAhead: 20, settleDelay: -10 }),
			],
		});

		expect(state.facet(EditorView.controlledTouchScroll)).toEqual({
			maxAhead: 4,
			settleDelay: 0,
		});
	});

	it("grows only ahead and returns to the baseline after settling", () => {
		expect(__test.applyViewportBuffer(500, 500, 4, 1, true, 600, 1)).toEqual({
			top: 500,
			bottom: 2400,
		});
		expect(__test.applyViewportBuffer(500, 500, 4, -1, true, 600, 1)).toEqual({
			top: 2400,
			bottom: 500,
		});
		expect(__test.applyViewportBuffer(500, 500, 4, 1, false, 600, 1)).toEqual({
			top: 500,
			bottom: 500,
		});
	});

	it("limits directional buffering to native touch and wheel activity", () => {
		const now = 10_000;

		expect(__test.isNativeScrollActivity(false, 0, 0, now)).toBe(false);
		expect(__test.isNativeScrollActivity(true, 0, 0, now)).toBe(true);
		expect(__test.isNativeScrollActivity(false, now - 1_999, 0, now)).toBe(
			true,
		);
		expect(__test.isNativeScrollActivity(false, 0, now - 199, now)).toBe(
			true,
		);
		expect(__test.isNativeScrollActivity(false, now - 2_000, 0, now)).toBe(
			false,
		);
	});

	it("claims only deliberate vertical gestures", () => {
		expect(__test.claimControlledTouchGesture(2, 5)).toBe("pending");
		expect(__test.claimControlledTouchGesture(8, 7)).toBe("horizontal");
		expect(__test.claimControlledTouchGesture(4, 8)).toBe("vertical");
		expect(__test.claimControlledTouchGesture(0, -8)).toBe("vertical");
	});

	it("uses only recent committed positions for momentum", () => {
		const samples = [
			{ at: 0, top: 0 },
			{ at: 40, top: 80 },
			{ at: 100, top: 200 },
		];

		expect(__test.estimateCommittedVelocity(samples, 100)).toBe(2000);
		expect(__test.estimateCommittedVelocity(samples.slice(0, 1), 100)).toBe(0);
		expect(
			__test.estimateCommittedVelocity(
				[
					{ at: 0, top: 0 },
					{ at: 100, top: 200 },
				],
				100,
			),
		).toBe(2000);
	});

	it("matches Android spline distance and duration snapshots", () => {
		expect(__test.createAndroidSplineFling(4000)).toEqual({
			initialVelocity: 4000,
			distance: 2156,
			duration: 1540,
		});
		expect(__test.createAndroidSplineFling(-4000)).toEqual({
			initialVelocity: -4000,
			distance: -2156,
			duration: 1540,
		});
		expect(__test.createAndroidSplineFling(20)).toBeNull();
		expect(__test.createAndroidSplineFling(20_000)?.initialVelocity).toBe(8000);
	});

	it("decelerates monotonically along the Android spline", () => {
		const fling = __test.createAndroidSplineFling(4000)!;
		const samples = [0, 0.25, 0.5, 0.75, 1].map((progress) =>
			__test.sampleAndroidSpline(fling, fling.duration * progress),
		);

		expect(samples.map((sample) => Math.round(sample.distance))).toEqual([
			0, 1259, 1851, 2094, 2156,
		]);
		for (let index = 1; index < samples.length; index++) {
			expect(samples[index].distance).toBeGreaterThan(samples[index - 1].distance);
			expect(samples[index].velocity).toBeLessThan(samples[index - 1].velocity);
		}
		expect(samples.at(-1)?.done).toBe(true);
	});

	it("commits the first covered move immediately and coalesces follow-ups", () => {
		const harness = controlledScrollHarness();
		try {
			harness.scrollDOM.dispatchEvent(touchEvent("touchstart", 100, 500));
			harness.scrollDOM.dispatchEvent(touchEvent("touchmove", 100, 480));
			harness.scrollDOM.dispatchEvent(touchEvent("touchmove", 100, 450));

			expect(harness.frameCount).toBe(1);
			expect(harness.log).toEqual(["scroll:520"]);
			harness.runFrame();
			expect(harness.scrollTop).toBe(550);
			expect(harness.log.filter((entry) => entry.startsWith("scroll:"))).toEqual(
				["scroll:520", "scroll:550"],
			);
		} finally {
			harness.controller.destroy();
		}
	});

	it("prewarms one screen in both directions while idle", () => {
		vi.useFakeTimers();
		const bounds = { from: 400, to: 600 };
		const harness = controlledScrollHarness(bounds, { autoCover: true });
		try {
			vi.advanceTimersByTime(400);

			const result = harness.controller.debugSnapshot();
			expect(result.idlePrewarmReady).toBe(true);
			expect(result.corridorFrom).toBe(0);
			expect(result.corridorTo).toBe(1700);
			expect(harness.log.filter((entry) => entry === "render").length).toBe(4);
		} finally {
			harness.controller.destroy();
			vi.useRealTimers();
		}
	});

	it("commits the first covered move directly from a prewarmed gesture", () => {
		vi.useFakeTimers();
		const harness = controlledScrollHarness(
			{ from: 0, to: 1200 },
			{ autoCover: true },
		);
		try {
			vi.advanceTimersByTime(400);
			harness.log.length = 0;
			harness.scrollDOM.dispatchEvent(touchEvent("touchstart", 100, 500));
			harness.scrollDOM.dispatchEvent(touchEvent("touchmove", 100, 450));

			expect(harness.scrollTop).toBe(550);
			expect(harness.frameCount).toBe(0);
			expect(harness.log).toEqual(["scroll:550"]);
		} finally {
			harness.controller.destroy();
			vi.useRealTimers();
		}
	});

	it("shrinks adaptive preparation chunks after a slow render", () => {
		vi.useFakeTimers();
		const harness = controlledScrollHarness(
			{ from: 400, to: 600 },
			{ autoCover: true, prepareMs: 24 },
		);
		try {
			vi.advanceTimersByTime(400);

			const result = harness.controller.debugSnapshot();
			expect(result.preparationDuration).toBe(24);
			expect(result.preparationChunkScreens).toBe(0.125);
			expect(result.idlePrewarmReady).toBe(true);
		} finally {
			harness.controller.destroy();
			vi.useRealTimers();
		}
	});

	it("passes horizontal gestures through without scrolling", () => {
		const harness = controlledScrollHarness();
		try {
			harness.scrollDOM.dispatchEvent(touchEvent("touchstart", 100, 500));
			const move = touchEvent("touchmove", 112, 495);
			harness.scrollDOM.dispatchEvent(move);

			expect(move.defaultPrevented).toBe(false);
			expect(harness.frameCount).toBe(0);
			expect(harness.scrollTop).toBe(500);
		} finally {
			harness.controller.destroy();
		}
	});

	it("leaves taps and long-press starts on the native selection path", () => {
		const harness = controlledScrollHarness();
		try {
			const start = touchEvent("touchstart", 100, 500);
			const end = touchEvent("touchend", 100, 500, 0);
			harness.scrollDOM.dispatchEvent(start);
			harness.scrollDOM.dispatchEvent(end);

			expect(start.defaultPrevented).toBe(false);
			expect(end.defaultPrevented).toBe(false);
			expect(harness.frameCount).toBe(0);
			expect(harness.scrollTop).toBe(500);
		} finally {
			harness.controller.destroy();
		}
	});

	it("clamps movement at the rendered edge and discards the remainder", () => {
		const harness = controlledScrollHarness({ from: 0, to: 520 });
		try {
			harness.scrollDOM.dispatchEvent(touchEvent("touchstart", 100, 500));
			harness.scrollDOM.dispatchEvent(touchEvent("touchmove", 100, 400));
			harness.runFrame();

			expect(harness.scrollTop).toBe(520);
			expect(harness.log).toContain("scroll:520");
		} finally {
			harness.controller.destroy();
		}
	});

	it("never commits movement beyond published highlight coverage", () => {
		const bounds = { from: 0, to: 600 };
		const harness = controlledScrollHarness(bounds);
		try {
			harness.controller.onHighlightCoverageReady();
			bounds.to = 1200;
			harness.scrollDOM.dispatchEvent(touchEvent("touchstart", 100, 500));
			harness.scrollDOM.dispatchEvent(touchEvent("touchmove", 100, 300));

			expect(harness.scrollTop).toBe(600);
			expect(harness.log).toContain("scroll:600");
		} finally {
			harness.controller.destroy();
		}
	});

	it("pins wrapped-line anchor corrections to the last controlled offset", () => {
		const harness = controlledScrollHarness({ from: 300, to: 700 });
		try {
			harness.scrollDOM.dispatchEvent(touchEvent("touchstart", 100, 500));
			harness.scrollDOM.dispatchEvent(touchEvent("touchmove", 100, 450));

			expect(harness.controller.clampToRenderedOffset(400_000)).toBe(550);
			expect(harness.controller.clampToRenderedOffset(-10_000)).toBe(550);
			harness.runFrame();
			expect(harness.controller.clampToRenderedOffset(400_000)).toBe(550);
		} finally {
			harness.controller.destroy();
		}
	});

	it("cancels queued movement when the view is destroyed", () => {
		const harness = controlledScrollHarness();
		expect(harness.scrollDOM.style.touchAction).toBe("pan-x");
		harness.scrollDOM.dispatchEvent(touchEvent("touchstart", 100, 500));
		harness.scrollDOM.dispatchEvent(touchEvent("touchmove", 100, 480));
		harness.scrollDOM.dispatchEvent(touchEvent("touchmove", 100, 450));
		harness.controller.destroy();
		harness.runFrame();

		expect(harness.scrollDOM.style.touchAction).toBe("");
		expect(harness.scrollTop).toBe(520);
		expect(harness.log.filter((entry) => entry.startsWith("scroll:"))).toEqual(
			["scroll:520"],
		);
	});

	it("cancels queued movement for composition and multi-touch", () => {
		for (const cancel of [
			(harness: ReturnType<typeof controlledScrollHarness>) =>
				harness.contentDOM.dispatchEvent(new Event("compositionstart")),
			(harness: ReturnType<typeof controlledScrollHarness>) =>
				harness.scrollDOM.dispatchEvent(touchEvent("touchmove", 100, 450, 2)),
		]) {
			const harness = controlledScrollHarness();
			try {
				harness.scrollDOM.dispatchEvent(touchEvent("touchstart", 100, 500));
				harness.scrollDOM.dispatchEvent(touchEvent("touchmove", 100, 480));
				harness.scrollDOM.dispatchEvent(touchEvent("touchmove", 100, 450));
				cancel(harness);
				harness.runFrame();

				expect(harness.scrollTop).toBe(520);
			} finally {
				harness.controller.destroy();
			}
		}
	});

	it("cancels active spline momentum for composition and destruction", () => {
		for (const cancel of [
			(harness: ReturnType<typeof controlledScrollHarness>) =>
				harness.contentDOM.dispatchEvent(new Event("compositionstart")),
			(harness: ReturnType<typeof controlledScrollHarness>) =>
				harness.controller.destroy(),
		]) {
			const harness = controlledScrollHarness({ from: 0, to: 1200 });
			try {
				startMomentum(harness);
				expect(harness.controller.debugSnapshot().active).toBe(true);
				cancel(harness);
				const stoppedAt = harness.scrollTop;
				harness.runFrame();

				expect(harness.scrollTop).toBe(stoppedAt);
				expect(harness.controller.debugSnapshot().active).toBe(false);
			} finally {
				harness.controller.destroy();
			}
		}
	});

	it("advances Android spline momentum through owned animation frames", () => {
		const harness = controlledScrollHarness({ from: 0, to: 1200 });
		try {
			startMomentum(harness);
			const started = harness.controller.debugSnapshot();
			expect(started.active).toBe(true);
			expect(started.releaseVelocity).toBe(4687);
			expect(started.expectedDistance).toBeGreaterThan(2500);

			harness.runFrame();
			expect(harness.scrollTop).toBeGreaterThan(700);
			expect(harness.scrollTop).toBeLessThanOrEqual(1200);
			expect(harness.log.some((entry) => entry.startsWith("smooth:"))).toBe(
				false,
			);
		} finally {
			harness.controller.destroy();
		}
	});

	it("ignores scrollend settling queued during an active touch gesture", () => {
		vi.useFakeTimers();
		const harness = controlledScrollHarness({ from: 0, to: 1200 });
		try {
			harness.scrollDOM.dispatchEvent(touchEvent("touchstart", 100, 500));
			harness.scrollDOM.dispatchEvent(touchEvent("touchmove", 100, 400));
			harness.runFrame();
			harness.scrollDOM.dispatchEvent(new Event("scrollend"));
			harness.scrollDOM.dispatchEvent(touchEvent("touchmove", 100, 300));
			harness.runFrame();
			harness.scrollDOM.dispatchEvent(touchEvent("touchend", 100, 300, 0));
			harness.runFrame();

			expect(harness.controller.debugSnapshot().active).toBe(true);
			vi.advanceTimersByTime(121);
			expect(harness.controller.debugSnapshot().active).toBe(true);
		} finally {
			harness.controller.destroy();
			vi.useRealTimers();
		}
	});

	it("recognizes a delayed event from its last committed offset", () => {
		const harness = controlledScrollHarness({ from: 0, to: 1200 });
		try {
			harness.scrollDOM.dispatchEvent(touchEvent("touchstart", 100, 500));
			harness.scrollDOM.dispatchEvent(touchEvent("touchmove", 100, 450));
			harness.runFrame(120);
			harness.scrollDOM.dispatchEvent(touchEvent("touchend", 100, 450, 0));
			harness.runFrame();

			expect(harness.controller.onScrollChanged()).toBe(true);
			harness.scrollDOM.scrollTop = 700;
			expect(harness.controller.onScrollChanged()).toBe(false);
		} finally {
			harness.controller.destroy();
		}
	});

	it("coalesces a post-settle highlight refresh after external scrolling", () => {
		vi.useFakeTimers();
		const harness = controlledScrollHarness({ from: 0, to: 1200 });
		try {
			harness.controller.onHighlightCoverageReady();
			harness.scrollDOM.scrollTop = 700;
			expect(harness.controller.onScrollChanged()).toBe(false);
			vi.advanceTimersByTime(121);

			expect(harness.log.filter((entry) => entry === "dispatch")).toEqual([
				"dispatch",
			]);
		} finally {
			harness.controller.destroy();
			vi.useRealTimers();
		}
	});

	it("does not fling after the finger pauses before release", () => {
		const harness = controlledScrollHarness({ from: 0, to: 1200 });
		try {
			harness.scrollDOM.dispatchEvent(touchEvent("touchstart", 100, 500));
			harness.scrollDOM.dispatchEvent(touchEvent("touchmove", 100, 400));
			harness.runFrame();
			harness.runFrame(120);
			harness.scrollDOM.dispatchEvent(touchEvent("touchend", 100, 400, 0));
			harness.runFrame();

			expect(harness.controller.debugSnapshot().active).toBe(false);
			expect(harness.controller.debugSnapshot().releaseVelocity).toBe(0);
		} finally {
			harness.controller.destroy();
		}
	});

	it("rolls a four-screen corridor through a longer fling", () => {
		const bounds = { from: 0, to: 1200 };
		const harness = controlledScrollHarness(bounds, {
			autoCover: true,
			scrollHeight: 20_000,
		});
		try {
			startMomentum(harness);
			for (let frame = 0; frame < 200 && harness.controller.debugSnapshot().active; frame++)
				harness.runFrame();

			const result = harness.controller.debugSnapshot();
			expect(harness.scrollTop - 700).toBeGreaterThan(2400);
			expect(result.corridorTo - (harness.scrollTop + 600)).toBeLessThanOrEqual(
				2400,
			);
			expect(result.termination).toBe("completed");
		} finally {
			harness.controller.destroy();
		}
	});

	it("limits delayed frames and permanently discards catch-up distance", () => {
		const harness = controlledScrollHarness(
			{ from: 0, to: 10_000 },
			{ scrollHeight: 20_000 },
		);
		try {
			startMomentum(harness);
			const beforeDelay = harness.scrollTop;
			harness.runFrame(64);
			const delayedStep = harness.scrollTop - beforeDelay;
			expect(delayedStep).toBeGreaterThan(0);
			expect(delayedStep).toBeLessThanOrEqual(256);

			const afterDelay = harness.scrollTop;
			harness.runFrame();
			expect(harness.scrollTop - afterDelay).toBeLessThan(128);
			for (let frame = 0; frame < 200 && harness.controller.debugSnapshot().active; frame++)
				harness.runFrame();
			expect(harness.controller.debugSnapshot().termination).toBe(
				"render-limited",
			);
		} finally {
			harness.controller.destroy();
		}
	});

	it("stops before moving after 120ms without covered progress", () => {
		const harness = controlledScrollHarness(
			{ from: 0, to: 10_000 },
			{ scrollHeight: 20_000 },
		);
		try {
			startMomentum(harness);
			const beforeStall = harness.scrollTop;
			harness.runFrame(120);

			expect(harness.scrollTop).toBe(beforeStall);
			expect(harness.controller.debugSnapshot().termination).toBe(
				"render-limited",
			);
		} finally {
			harness.controller.destroy();
		}
	});

	it("ends momentum when rendered coverage cannot advance", () => {
		const harness = controlledScrollHarness({ from: 0, to: 700 });
		try {
			startMomentum(harness);
			for (let frame = 0; frame < 8; frame++) harness.runFrame();

			expect(harness.scrollTop).toBe(700);
			expect(harness.controller.debugSnapshot().termination).toBe(
				"render-limited",
			);
		} finally {
			harness.controller.destroy();
		}
	});

	it("stops momentum at the document edge without overscroll", () => {
		const harness = controlledScrollHarness(
			{ from: 0, to: 700 },
			{ scrollHeight: 1300 },
		);
		try {
			harness.scrollDOM.dispatchEvent(touchEvent("touchstart", 100, 500));
			harness.scrollDOM.dispatchEvent(touchEvent("touchmove", 100, 450));
			harness.runFrame();
			harness.scrollDOM.dispatchEvent(touchEvent("touchmove", 100, 400));
			harness.runFrame();
			harness.scrollDOM.dispatchEvent(touchEvent("touchend", 100, 400, 0));
			for (let frame = 0; frame < 20; frame++) harness.runFrame();

			expect(harness.scrollTop).toBe(700);
			expect(harness.controller.debugSnapshot().termination).toBe("edge");
		} finally {
			harness.controller.destroy();
		}
	});

	it("keeps split editor controllers independent", () => {
		const first = controlledScrollHarness();
		const second = controlledScrollHarness();
		try {
			first.scrollDOM.dispatchEvent(touchEvent("touchstart", 100, 500));
			first.scrollDOM.dispatchEvent(touchEvent("touchmove", 100, 450));
			first.runFrame();

			expect(first.scrollTop).toBe(550);
			expect(second.scrollTop).toBe(500);
			expect(second.log).toEqual([]);
		} finally {
			first.controller.destroy();
			second.controller.destroy();
		}
	});

});
