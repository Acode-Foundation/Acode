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
 * @param startPx font size (px) when the gesture started
 * @param startDistance distance (px) between the two touches when the gesture started
 * @param distance current distance (px) between the two touches
 */
export function computePinchFontSize(
	startPx: number,
	startDistance: number,
	distance: number,
): number {
	if (!Number.isFinite(startPx) || startPx <= 0) startPx = DEFAULT_FONT_SIZE;
	if (
		!Number.isFinite(startDistance) ||
		startDistance <= 0 ||
		!Number.isFinite(distance)
	) {
		return clampEditorFontSize(startPx);
	}
	return clampEditorFontSize((startPx * distance) / startDistance);
}

function touchDistance(a: PinchPoint, b: PinchPoint): number {
	return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
}

function readFontSizePx(): number {
	const current = settings?.value?.fontSize || `${DEFAULT_FONT_SIZE}px`;
	const numeric = Number.parseInt(String(current), 10);
	return numeric > 0 ? numeric : DEFAULT_FONT_SIZE;
}

export default function pinchZoom() {
    return ViewPlugin.define((view) => {
        const gesture = {
            pinching: false,
            startDistance: 0,
            startPx: DEFAULT_FONT_SIZE,
            lastPx: DEFAULT_FONT_SIZE,
            lastUpdate: 0,
        };

        function applyFontSize(px: number) {
            if (px === gesture.lastPx) return;
            gesture.lastPx = px;
            settings.value.fontSize = `${px}px`;
            settings.update(undefined, false, false);
        }

        function persistFontSize() {
            if (gesture.lastPx === gesture.startPx) return;
            settings.update(false);
        }

        function onTouchStart(event: TouchEvent) {
            if (event.touches.length < 2) return;
            event.preventDefault();
            gesture.pinching = true;
            gesture.startDistance = touchDistance(event.touches[0], event.touches[1]);
            gesture.startPx = readFontSizePx();
            gesture.lastPx = gesture.startPx;
            gesture.lastUpdate = 0;
        }

        function onTouchMove(event: TouchEvent) {
            if (!gesture.pinching || event.touches.length < 2) return;
            event.preventDefault();
            const now = Date.now();
            if (now - gesture.lastUpdate < ZOOM_THROTTLE_MS) return;
            gesture.lastUpdate = now;
            const distance = touchDistance(event.touches[0], event.touches[1]);
            applyFontSize(
                computePinchFontSize(gesture.startPx, gesture.startDistance, distance),
            );
        }

        function endPinch(event: TouchEvent) {
            if (!gesture.pinching) return;
            if (event.touches.length >= 2) return;
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
