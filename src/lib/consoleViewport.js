/**
 * Returns the actually visible browser rectangle. On mobile this shrinks with
 * the software keyboard even when the layout viewport remains full height.
 */
export function getConsoleViewportRect(windowObject = window) {
	const viewport = windowObject.visualViewport;
	const documentHeight = windowObject.document?.documentElement?.clientHeight;
	const visibleHeights = [
		viewport?.height,
		windowObject.innerHeight,
		documentHeight,
	].filter((height) => Number.isFinite(height) && height > 0);
	return {
		height: Math.round(Math.min(...visibleHeights)),
		width: Math.round(viewport?.width || windowObject.innerWidth),
		top: Math.round(viewport?.offsetTop || 0),
		left: Math.round(viewport?.offsetLeft || 0),
	};
}

export function applyConsoleViewport(element, windowObject = window) {
	const { height, width, top, left } = getConsoleViewportRect(windowObject);
	element.style.setProperty("--console-viewport-height", `${height}px`);
	element.style.setProperty("--console-viewport-width", `${width}px`);
	element.style.setProperty("--console-viewport-top", `${top}px`);
	element.style.setProperty("--console-viewport-left", `${left}px`);
}
