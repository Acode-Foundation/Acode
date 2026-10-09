
import { ViewPlugin } from "@codemirror/view";
import settings from "lib/settings";

const ZOOM_THROTTLE_MS = 50;
const MIN_FONT_SIZE = 6;
const MAX_FONT_SIZE = 72;
const DEFAULT_FONT_SIZE = 12;

interface PinchPoint {
	clientX: number;
	clientY: number;
}

export function clampEditorFontSize(px: number): number {
	if (!Number.isFinite(px)) return DEFAULT_FONT_SIZE;
	return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(px)));
}

/**
 * Convert a pinch distance ratio into an absolute font size.
 * @param startPx font size in pixels when the gesture started
 * @param startDistance distance between the two touches at the start
 * @param distance current distance between the two touches
 */
export function computePinchFontSize(
	startPx: number,
	startDistance: number,
	distance: number,
): number {
	if (!Number.isFinite(startPx) || startPx <= 0) {
		startPx = DEFAULT_FONT_SIZE;
	}

	if (
		!Number.isFinite(startDistance) ||
		startDistance <= 0 ||
		!Number.isFinite(distance) ||
		distance <= 0
	) {
		return clampEditorFontSize(startPx);
	}

	return clampEditorFontSize((startPx * distance) / startDistance);
}

function touchDistance(a: PinchPoint, b: PinchPoint): number {
	return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
}

function readFontSizePx(view: { contentDOM: HTMLElement }): number {
	const configuredSize = String(
		settings?.value?.fontSize || `${DEFAULT_FONT_SIZE}px`,
	).trim();

	const match = configuredSize.match(
		/^(\d+(?:\.\d+)?)(px|rem|em|pt)?$/i,
	);

	if (match) {
		const value = Number.parseFloat(match[1]);
		const unit = (match[2] || "px").toLowerCase();

		if (Number.isFinite(value) && value > 0) {
			switch (unit) {
				case "rem":
					return value * Number.parseFloat(
						getComputedStyle(document.documentElement).fontSize || "16",
					);
				case "em":
					return value * readComputedFontSize(view);
				case "pt":
					return value * (96 / 72);
				default:
					return value;
			}
		}
	}

	return readComputedFontSize(view);
}

function readComputedFontSize(view: { contentDOM: HTMLElement }): number {
	const computedSize = Number.parseFloat(
		getComputedStyle(view.contentDOM).fontSize,
	);

	return Number.isFinite(computedSize) && computedSize > 0
		? computedSize
		: DEFAULT_FONT_SIZE;
}

export default function pinchZoom() {
	return ViewPlugin.define((view) => {
		const gesture = {
			pinching: false,
			startDistance: 0,
			startPx: DEFAULT_FONT_SIZE,
			lastPx: DEFAULT_FONT_SIZE,
			pendingDistance: 0,
			lastUpdate: 0,
			originalInlineFontSize: "",
			originalSetting: "",
		};

		function applyFontSize(px: number) {
			px = clampEditorFontSize(px);
			if (px === gesture.lastPx) return;

			gesture.lastPx = px;

			// Preview directly so returning to the saved size also updates the editor.
			view.contentDOM.style.fontSize = `${px}px`;

			settings.value.fontSize = `${px}px`;
			settings.update(undefined, false, false);
		}

		function persistFontSize() {
			if (gesture.lastPx !== gesture.startPx) {
				settings.value.fontSize = `${gesture.lastPx}px`;
				settings.update(false);
			} else {
				// Restore the original unit/value if the gesture made no net change.
				settings.value.fontSize = gesture.originalSetting;
			}

			// Let the normal settings styles control the editor after the gesture.
			view.contentDOM.style.fontSize = gesture.originalInlineFontSize;
		}

		function onTouchStart(event: TouchEvent) {
			if (gesture.pinching || event.touches.length < 2) return;

			event.preventDefault();

			gesture.pinching = true;
			gesture.startDistance = touchDistance(
				event.touches[0],
				event.touches[1],
			);
			gesture.startPx = readFontSizePx(view);
			gesture.lastPx = gesture.startPx;
			gesture.pendingDistance = gesture.startDistance;
			gesture.lastUpdate = 0;
			gesture.originalInlineFontSize = view.contentDOM.style.fontSize;
			gesture.originalSetting = String(
				settings.value.fontSize || `${DEFAULT_FONT_SIZE}px`,
			);
		}

		function onTouchMove(event: TouchEvent) {
			if (!gesture.pinching || event.touches.length < 2) return;

			event.preventDefault();

			// Always remember the latest movement, even if the preview is throttled.
			gesture.pendingDistance = touchDistance(
				event.touches[0],
				event.touches[1],
			);

			const now = Date.now();
			if (now - gesture.lastUpdate < ZOOM_THROTTLE_MS) return;

			gesture.lastUpdate = now;

			applyFontSize(
				computePinchFontSize(
					gesture.startPx,
					gesture.startDistance,
					gesture.pendingDistance,
				),
			);
		}

		function endPinch(event: TouchEvent) {
			if (!gesture.pinching || event.touches.length >= 2) return;

			// Apply the final movement even if it fell inside the throttle window.
			applyFontSize(
				computePinchFontSize(
					gesture.startPx,
					gesture.startDistance,
					gesture.pendingDistance,
				),
			);

			gesture.pinching = false;
			persistFontSize();
		}

		const { dom } = view;

		dom.addEventListener("touchstart", onTouchStart, { passive: false });
		dom.addEventListener("touchmove", onTouchMove, { passive: false });
		dom.addEventListener("touchend", endPinch);
		dom.addEventListener("touchcancel", endPinch);

		return {
			destroy() {
				dom.removeEventListener("touchstart", onTouchStart);
				dom.removeEventListener("touchmove", onTouchMove);
				dom.removeEventListener("touchend", endPinch);
				dom.removeEventListener("touchcancel", endPinch);
			},
		};
	});
}
