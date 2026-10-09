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

/**
 * Read the font size the editor is actually displaying, in pixels.
 *
 * The font theme only sets font-size on the editor root, and settings.json may
 * use any unit accepted by config.FONT_SIZE (px|rem|em|pt|mm|pc|in), so the
 * computed style of the content element is the only reliable base for the pinch
 * ratio. The saved setting is used as a fallback only when no computed style is
 * available (e.g. in tests).
 */
function readFontSizePx(view: { contentDOM: HTMLElement }): number {
	const computed = Number.parseFloat(
		getComputedStyle(view.contentDOM).fontSize,
	);
	if (Number.isFinite(computed) && computed > 0) return computed;

	const match = String(settings?.value?.fontSize || `${DEFAULT_FONT_SIZE}px`)
		.trim()
		.match(/^(\d+(?:\.\d+)?)px$/i);

	if (match) {
		const value = Number.parseFloat(match[1]);
		if (Number.isFinite(value) && value > 0) return value;
	}

	return DEFAULT_FONT_SIZE;
}

export default function pinchZoom() {
	return ViewPlugin.define((view) => {
		const gesture = {
			pinching: false,
			moved: false,
			startDistance: 0,
			startPx: DEFAULT_FONT_SIZE,
			lastPx: DEFAULT_FONT_SIZE,
			pendingDistance: 0,
			lastUpdate: 0,
			originalInlineFontSize: "",
		};

		function applyFontSize(px: number) {
			px = clampEditorFontSize(px);
			if (px === gesture.lastPx) return;

			gesture.lastPx = px;

			// Preview directly on this editor. settings.update() only notifies
			// update:fontSize listeners while the value differs from the last SAVED
			// value, so writing settings mid-gesture can never undo a preview once
			// the pinch returns to its starting size, and would leave the font
			// theme stale as soon as the inline preview is removed.
			view.contentDOM.style.fontSize = `${px}px`;
		}

		function persistFontSize() {
			if (gesture.lastPx !== gesture.startPx) {
				// The value differs from the saved one, so this fires update:fontSize
				// (rebuilding the font theme in every pane) and writes settings.json
				// exactly once per gesture, before the inline preview is dropped below.
				settings.value.fontSize = `${gesture.lastPx}px`;
				settings.update(false);
			}

			// Let the settings-driven font theme control the editor after the gesture.
			view.contentDOM.style.fontSize = gesture.originalInlineFontSize;
		}

		function onTouchStart(event: TouchEvent) {
			if (gesture.pinching || event.touches.length < 2) return;

			event.preventDefault();

			gesture.pinching = true;
			gesture.moved = false;
			gesture.startDistance = touchDistance(
				event.touches[0],
				event.touches[1],
			);
			gesture.startPx = readFontSizePx(view);
			gesture.lastPx = gesture.startPx;
			gesture.pendingDistance = gesture.startDistance;
			gesture.lastUpdate = 0;
			gesture.originalInlineFontSize = view.contentDOM.style.fontSize;
		}

		function onTouchMove(event: TouchEvent) {
			if (!gesture.pinching || event.touches.length < 2) return;

			event.preventDefault();

			// The gesture received a real movement; remember the latest distance
			// even when the preview itself is throttled.
			gesture.moved = true;
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

			// Only flush the latest movement when the gesture actually moved:
			// a two-finger tap must not round or clamp the saved size
			// (9.5px -> 10px, 99px -> 72px).
			if (gesture.moved) {
				applyFontSize(
					computePinchFontSize(
						gesture.startPx,
						gesture.startDistance,
						gesture.pendingDistance,
					),
				);
			}

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
				// Never leave a half-finished preview behind.
				if (gesture.pinching) {
					view.contentDOM.style.fontSize = gesture.originalInlineFontSize;
					gesture.pinching = false;
				}
				dom.removeEventListener("touchstart", onTouchStart);
				dom.removeEventListener("touchmove", onTouchMove);
				dom.removeEventListener("touchend", endPinch);
				dom.removeEventListener("touchcancel", endPinch);
			},
		};
	});
}