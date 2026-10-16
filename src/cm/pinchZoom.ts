import { ViewPlugin } from "@codemirror/view";
import settings from "lib/settings";
import {
  DEFAULT_EDITOR_FONT_SIZE,
  clampEditorFontSize,
} from "cm/editorFontSize";

const ZOOM_THROTTLE_MS = 50;
const MOVE_THRESHOLD_PX = 15;
const PINCH_CONFIRMATION_MS = 120;
const GESTURE_LISTENER_OPTIONS = { capture: true, passive: false } as const;


interface PinchPoint {
	clientX: number;
	clientY: number;
}

interface TrackedTouch extends PinchPoint {
	identifier: number;
}

function distance(a: PinchPoint, b: PinchPoint): number {
	return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
}

export function computePinchFontSize(
	startPx: number,
	startDistance: number,
	currentDistance: number,
): number {
	if (!Number.isFinite(startPx) || startPx <= 0) {
		startPx = DEFAULT_EDITOR_FONT_SIZE;
	}

	if (
		!Number.isFinite(startDistance) ||
		startDistance <= 0 ||
		!Number.isFinite(currentDistance) ||
		currentDistance <= 0
	) {
		return clampEditorFontSize(startPx);
	}

	return clampEditorFontSize(
		(startPx * currentDistance) / startDistance,
	);
}

function readFontSizePx(view: { dom: HTMLElement }): number {
	const computed = Number.parseFloat(getComputedStyle(view.dom).fontSize);
	return Number.isFinite(computed) && computed > 0
		? computed
		: DEFAULT_EDITOR_FONT_SIZE;
}

function getTrackedTouch(
	touches: TouchList,
	identifier: number,
): TrackedTouch | undefined {
	for (let i = 0; i < touches.length; i++) {
		const touch = touches.item(i);
		if (touch?.identifier === identifier) {
			return {
				identifier: touch.identifier,
				clientX: touch.clientX,
				clientY: touch.clientY,
			};
		}
	}
	return undefined;
}

function reportSettingsError(error: unknown): void {
	console.error("Failed to save editor font size:", error);
}

const pinchZoomExtension = ViewPlugin.define((view) => {
	const gesture = {
		pinching: false,
		moved: false,
		firstId: -1,
		secondId: -1,
		startDistance: 0,
		startPx: DEFAULT_EDITOR_FONT_SIZE,
		lastPx: DEFAULT_EDITOR_FONT_SIZE,
		pendingDistance: 0,
		lastUpdate: 0,
		originalInlineFontSize: "",
		candidateSince: 0,
		candidateDistance: 0,
	};

	let destroyed = false;
	let scheduledFrame: number | null = null;

	function requestLayoutMeasurement() {
		view.requestMeasure();
	}

	function applyPreview(px: number) {
		px = clampEditorFontSize(px);
		if (px === gesture.lastPx) return;

		gesture.lastPx = px;
		view.dom.style.fontSize = `${px}px`;
		requestLayoutMeasurement();
	}

	function applyPendingPreview() {
		applyPreview(
			computePinchFontSize(
				gesture.startPx,
				gesture.startDistance,
				gesture.pendingDistance,
			),
		);
	}

	function cancelScheduledPreview() {
		if (scheduledFrame != null) {
			cancelAnimationFrame(scheduledFrame);
			scheduledFrame = null;
		}
	}

	function addGestureListeners() {
		document.addEventListener("touchmove", onTouchMove, GESTURE_LISTENER_OPTIONS);
		document.addEventListener("touchend", endPinch, GESTURE_LISTENER_OPTIONS);
		document.addEventListener("touchcancel", endPinch, GESTURE_LISTENER_OPTIONS);
	}

	function removeGestureListeners() {
		document.removeEventListener("touchmove", onTouchMove, true);
		document.removeEventListener("touchend", endPinch, true);
		document.removeEventListener("touchcancel", endPinch, true);
	}

	function clearGesture() {
		gesture.pinching = false;
		gesture.firstId = -1;
		gesture.secondId = -1;
	}

	function restorePreview() {
		view.dom.style.fontSize = gesture.originalInlineFontSize;
		requestLayoutMeasurement();
	}
	function persistFontSize() {
		if (!gesture.moved || gesture.lastPx === gesture.startPx) {
			restorePreview();
			return;
		}

		settings.value.fontSize = `${gesture.lastPx}px`;

		// Restore the inline preview immediately. The saved setting and
		// font theme now control the editor's font size.
		restorePreview();

		// Handle the asynchronous save without delaying touch handling.
		void Promise.resolve(settings.update(false)).catch(reportSettingsError);
	}


	function getCurrentTrackedTouches(event: TouchEvent) {
		const first = getTrackedTouch(event.touches, gesture.firstId);
		const second = getTrackedTouch(event.touches, gesture.secondId);

		if (!first || !second) return undefined;
		return { first, second };
	}

	function onTouchStart(event: TouchEvent) {
		if (gesture.pinching) {
			// Recovery path: if the original fingers' move/end events were
			// lost (CodeMirror unmounted the line under a finger), the
			// gesture is stuck. Abandon it so the next pinch can start.
			const fingerStillDown =
				getTrackedTouch(event.touches, gesture.firstId) ||
				getTrackedTouch(event.touches, gesture.secondId);
			if (fingerStillDown) return;
			cancelScheduledPreview();
			removeGestureListeners();
			clearGesture();
			restorePreview();
		}

		// Start only when exactly two fingers land together; a three-finger
		// touch keeps Acode's normal behaviour (scrolling etc.).
		if (event.touches.length !== 2) return;

		const first = event.touches.item(0);
		const second = event.touches.item(1);
		if (!first || !second) return;

		// This event is recognized as the start of a two-finger gesture.
		event.preventDefault();
		event.stopPropagation();

		gesture.pinching = true;
		gesture.moved = false;
		gesture.candidateSince = 0;
		gesture.candidateDistance = 0;
		gesture.firstId = first.identifier;
		gesture.secondId = second.identifier;
		gesture.startDistance = distance(first, second);
		gesture.pendingDistance = gesture.startDistance;
		gesture.startPx = readFontSizePx(view);
		gesture.lastPx = gesture.startPx;
		gesture.lastUpdate = 0;
		gesture.originalInlineFontSize = view.dom.style.fontSize;

		// The rest of the gesture is observed on document: a finger's
		// original target (.cm-line) can be unmounted by the preview
		// re-measure, and events for a detached node never bubble back.
		addGestureListeners();
	}

	function onTouchMove(event: TouchEvent) {
		if (!gesture.pinching) return;
		if (!event.cancelable) {
			removeGestureListeners();
			restorePreview();
			clearGesture();
			return;
		}
		const touches = getCurrentTrackedTouches(event);

		// Do not silently switch to a third finger if an original finger leaves.
		if (!touches) {
			event.preventDefault();
			event.stopPropagation();
			return;
		}

		event.preventDefault();
		event.stopPropagation();

		const currentDistance = distance(touches.first, touches.second);
		gesture.pendingDistance = currentDistance;
		if (!gesture.moved) {
			const distanceChange = currentDistance - gesture.startDistance;
			const absDistanceChange = Math.abs(distanceChange);
			const now = Date.now();

			if (absDistanceChange < MOVE_THRESHOLD_PX) {
				gesture.candidateSince = 0;
				gesture.candidateDistance = 0;
				return;
			}

			if (gesture.candidateSince === 0) {
				gesture.candidateSince = now;
				gesture.candidateDistance = currentDistance;
				return;
			}

			const initialDirection = Math.sign(
				gesture.candidateDistance - gesture.startDistance,
			);
			const currentDirection = Math.sign(distanceChange);

			if (initialDirection !== currentDirection) {
				gesture.candidateSince = now;
				gesture.candidateDistance = currentDistance;
				return;
			}

			if (now - gesture.candidateSince < PINCH_CONFIRMATION_MS) {
				return;
			}

			gesture.moved = true;
		}

		const now = Date.now();
		if (now - gesture.lastUpdate >= ZOOM_THROTTLE_MS) {
			gesture.lastUpdate = now;
			applyPendingPreview();
			return;
		}

		// Inside the throttle window: coalesce into the next animation frame so
		// the latest pending distance is applied and the preview never goes stale.
		if (scheduledFrame == null) {
			scheduledFrame = requestAnimationFrame(() => {
				scheduledFrame = null;
				if (destroyed || !gesture.pinching) return;
				applyPendingPreview();
			});
		}

	}

	function endPinch(event: TouchEvent) {
		if (!gesture.pinching) return;

		const originalTouchesRemain =
			getTrackedTouch(event.touches, gesture.firstId) &&
			getTrackedTouch(event.touches, gesture.secondId);

		// If both original fingers remain, a third finger was added or removed.
		// Keep the original gesture alive rather than restarting it.
		if (originalTouchesRemain) return;
		removeGestureListeners();
		event.preventDefault();
		event.stopPropagation();

		cancelScheduledPreview();
		// A pinch can be held still after spreading (no further touchmove).
		// Confirm the sustained candidate so the zoom is not silently lost.
		if (!gesture.moved && gesture.candidateSince !== 0) {
			const distanceChange =
				gesture.pendingDistance - gesture.startDistance;
			const initialDirection = Math.sign(
				gesture.candidateDistance - gesture.startDistance,
			);
			if (
				Date.now() - gesture.candidateSince >= PINCH_CONFIRMATION_MS &&
				Math.sign(distanceChange) === initialDirection
			) {
				gesture.moved = true;
			}
		}

		// Apply the latest movement even if the throttle skipped its preview.
		if (gesture.moved) {
			applyPendingPreview();
		}

		clearGesture();
		persistFontSize();
	}

	const target = view.contentDOM;

	target.addEventListener("touchstart", onTouchStart, {
		passive: false,
		capture: true,
	});

	return {
		destroy() {
			destroyed = true;
			cancelScheduledPreview();
			removeGestureListeners();
			if (gesture.pinching) {
				clearGesture();
				restorePreview();
			}

			target.removeEventListener("touchstart", onTouchStart, true);
			target.removeEventListener("touchmove", onTouchMove, true);
			target.removeEventListener("touchend", endPinch, true);
			target.removeEventListener("touchcancel", endPinch, true);
		},
	};
});

// Reuse the same plugin definition for every editor.
export default pinchZoomExtension;
