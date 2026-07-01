import { quickToolUsed } from "./quickTools";

let debounceTimer;
let lastInput = null;

const setKeyboardInput = () => {
	lastInput = "keyboard";
};

document.addEventListener("keydown", setKeyboardInput, true);
document.addEventListener("beforeinput", setKeyboardInput, true);
document.addEventListener("input", setKeyboardInput, true);
document.addEventListener("compositionstart", setKeyboardInput, true);

function setTouched() {
	clearTimeout(debounceTimer);
	document.body.setAttribute("data-editor-touched", "true");
	debounceTimer = setTimeout(() => {
		document.body.removeAttribute("data-editor-touched");
	}, 200);
}

document.addEventListener(
	"pointerdown",
	(e) => {
		lastInput = "pointer";
		if (e.target.closest(".editor-container")) setTouched();
	},
	true,
);

document.addEventListener("selectionchange", () => {
	if (lastInput !== "pointer" || quickToolUsed) return;
	const sel = document.getSelection();
	if (!sel?.rangeCount) return;
	const node = sel.getRangeAt(0).startContainer;
	if (!node) return;
	const el = node.nodeType === 3 ? node.parentElement : node;
	if (el?.closest(".editor-container")) setTouched();
});
