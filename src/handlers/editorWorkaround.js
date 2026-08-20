import { createEditorInteractionGuard } from "lib/editorInteractionGuard";
import { quickToolUsed } from "./quickTools";

let lastInput = null;
const interactionGuard = createEditorInteractionGuard();

const setKeyboardInput = () => {
	lastInput = "keyboard";
};

document.addEventListener("keydown", setKeyboardInput, true);
document.addEventListener("beforeinput", setKeyboardInput, true);
document.addEventListener("input", setKeyboardInput, true);
document.addEventListener("compositionstart", setKeyboardInput, true);

function setTouched() {
	interactionGuard.markActive();
}

document.addEventListener(
	"pointerdown",
	(e) => {
		lastInput = "pointer";
		if (e.target.closest(".editor-container")) {
			setTouched();
			return;
		}
		interactionGuard.suppress(e);
	},
	true,
);

// Avoid toggling pointer-events on the scrollable quick-tools container. Older
// Android WebViews repaint its normally hidden horizontal scrollbar each time.
for (const eventName of [
	"touchstart",
	"mousedown",
	"click",
	"contextmenu",
	"wheel",
]) {
	document.addEventListener(eventName, (e) => interactionGuard.suppress(e), {
		capture: true,
		passive: false,
	});
}

document.addEventListener("selectionchange", () => {
	if (lastInput !== "pointer" || quickToolUsed) return;
	const sel = document.getSelection();
	if (!sel?.rangeCount) return;
	const node = sel.getRangeAt(0).startContainer;
	if (!node) return;
	const el = node.nodeType === 3 ? node.parentElement : node;
	if (el?.closest(".editor-container")) setTouched();
});
