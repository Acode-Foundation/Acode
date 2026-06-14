let debounceTimer;
let lastInput = null;
let keyboardTimer;

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

document.addEventListener("keydown", () => {
	lastInput = "keyboard";
	clearTimeout(keyboardTimer);
	keyboardTimer = setTimeout(() => {
		lastInput = null;
	}, 500);
});

document.addEventListener("selectionchange", () => {
	if (lastInput !== "pointer") return;
	const sel = document.getSelection();
	if (!sel?.rangeCount) return;
	const node = sel.getRangeAt(0).startContainer;
	if (!node) return;
	const el = node.nodeType === 3 ? node.parentElement : node;
	if (el?.closest(".editor-container")) setTouched();
});
