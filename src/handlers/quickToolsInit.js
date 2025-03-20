import quickTools from "components/quickTools";
import constants from "lib/constants";
import appSettings from "lib/settings";
import actions, { key } from "./quickTools";

const CONTEXT_MENU_TIMEOUT = 500;
const MOVE_X_THRESHOLD = 50;

let time;
let moveX;
let movedX; // total moved x
let touchMoved;
let isClickMode;
let contextmenu;
let startTime;
let contextmenuTimeout;
let active = false; // is button already active
let slide = 0;

/**@type {HTMLElement} */
let $row;
/**@type {number} */
let timeout;
/**@type {HTMLElement} */
let $touchstart;

function reset() {
	moveX = 0;
	movedX = 0;
	time = 300;
	$row = null;
	$touchstart = null;
	contextmenu = false;
	touchMoved = undefined;
	contextmenuTimeout = null;
	active = false;
}

/**
 * Initialize quick tools
 * @param {HTMLElement} $footer
 */
export default function init() {
	const { $footer, $toggler, $input } = quickTools;

	$toggler.addEventListener("click", (e) => {
		e.preventDefault();
		e.stopPropagation();
		actions("toggle");
	});

	key.on("shift", (value) => {
		if (value) $footer.setAttribute("data-shift", "true");
		else $footer.removeAttribute("data-shift");
	});

	key.on("ctrl", (value) => {
		if (value) $footer.setAttribute("data-ctrl", "true");
		else $footer.removeAttribute("data-ctrl");
	});

	key.on("alt", (value) => {
		if (value) $footer.setAttribute("data-alt", "true");
		else $footer.removeAttribute("data-alt");
	});

	key.on("meta", (value) => {
		if (value) $footer.setAttribute("data-meta", "true");
		else $footer.removeAttribute("data-meta");
	});

	editorManager.on(["file-content-changed", "switch-file"], () => {
		if (editorManager.activeFile?.isUnsaved) {
			$footer.setAttribute("data-unsaved", "true");
		} else {
			$footer.removeAttribute("data-unsaved");
		}
	});

	editorManager.on("save-file", () => {
		$footer.removeAttribute("data-unsaved");
	});

	editorManager.editor.on("focus", () => {
		if (key.shift || key.ctrl || key.alt || key.meta) {
			quickTools.$input.focus();
		}
	});

	root.append($footer, $toggler);
	document.body.append($input);
	if (
		appSettings.value.quickToolsTriggerMode ===
		appSettings.QUICKTOOLS_TRIGGER_MODE_CLICK
	) {
		isClickMode = true;
		$footer.addEventListener("click", onclick);
		$footer.addEventListener("contextmenu", oncontextmenu, true);
		$footer.addEventListener("wheel", onwheel, { passive: false });
	} else {
		$footer.addEventListener("touchstart", touchstart);
		$footer.addEventListener("keydown", touchstart);
	}

	appSettings.on("update:quickToolsTriggerMode", (value) => {
		if (value === appSettings.QUICKTOOLS_TRIGGER_MODE_CLICK) {
			$footer.removeEventListener("touchstart", touchstart);
			$footer.removeEventListener("keydown", touchstart);
			$footer.addEventListener("contextmenu", onclick, true);
			$footer.addEventListener("click", onclick);
			$footer.addEventListener("wheel", onwheel, { passive: false });
		} else {
			$footer.removeEventListener("contextmenu", onclick, true);
			$footer.removeEventListener("click", onclick);
			$footer.removeEventListener("wheel", onwheel);
			$footer.addEventListener("keydown", touchstart);
			$footer.addEventListener("touchstart", touchstart);
		}
	});
}

function onwheel(e) {
	e.preventDefault();
	const $el = e.target;
	const { $row1, $row2 } = quickTools;
	let $row;

	if ($row1?.contains($el)) {
		$row = $row1;
	} else if ($row2?.contains($el)) {
		$row = $row2;
	}

	if ($row) {
		$row.scrollLeft += e.deltaY;
	}
}

function onclick(e) {
	reset();

	e.preventDefault();
	e.stopPropagation();
	click(e.target);
	clearTimeout(timeout);
}

function touchstart(e) {
	reset();

	const $el = e.target;
	if ($el instanceof HTMLInputElement) {
		return;
	}

	startTime = performance.now();
	$touchstart = $el;
	e.preventDefault();
	e.stopPropagation();

	if ($el.dataset.repeat === "true") {
		contextmenuTimeout = setTimeout(() => {
			if (touchMoved) return;
			contextmenu = true;
			oncontextmenu(e);
		}, CONTEXT_MENU_TIMEOUT);
	}

	if ($el.classList.contains("active")) {
		active = true;
	} else {
		$el.classList.add("active");
	}

	document.addEventListener("touchmove", touchmove);
	document.addEventListener("keyup", touchcancel);
	document.addEventListener("touchend", touchend);
	document.addEventListener("touchcancel", touchcancel);
}

/**
 * Event handler for touchmove event
 * @param {TouchEvent} e
 */
function touchmove(e) {
	if (contextmenu || touchMoved === false) return;

	const $el = e.target;
	const { $row1, $row2 } = quickTools;
	const { clientX } = e.touches[0];

	if (moveX === 0) {
		moveX = clientX;
		return;
	}

	const diff = moveX - clientX;
	if (touchMoved === undefined) {
		if (Math.abs(diff) > appSettings.value.touchMoveThreshold) {
			touchMoved = true;
		} else {
			if ($row) {
				const movedX = $row.scrollLeft % $row.clientWidth;
				// $row.scrollBy(-movedX, 0);
				// scrollBy is not working on mobile
				$row.scrollLeft -= movedX;
			}
			touchMoved = false;
			return;
		}
	}

	movedX += diff;

	if (!$row) {
		if ($row1?.contains($el)) {
			$row = $row1;
		} else if ($row2?.contains($el)) {
			$row = $row2;
		}

		slide = Number.parseInt($row.scrollLeft / $row.clientWidth, 10);
	}

	if ($row) {
		$row.style.scrollBehavior = "unset";
		$row.scrollLeft += diff;
	}

	if (!active) $touchstart.classList.remove("active");
	moveX = clientX;
}

/**
 * Event handler for touchend event
 * @param {TouchEvent} e
 */
function touchend(e) {
	const { $row1 } = quickTools;
	const $el = document.elementFromPoint(
		e.changedTouches[0].clientX,
		e.changedTouches[0].clientY,
	);

	if (touchMoved && $row) {
		$row.style.scrollBehavior = "smooth";
		let scroll = 0;
		if (movedX < 0 && movedX < -MOVE_X_THRESHOLD) {
			scroll = (slide - 1) * $row.clientWidth;
		} else if (movedX > 0 && movedX > MOVE_X_THRESHOLD) {
			scroll = (slide + 1) * $row.clientWidth;
		} else {
			scroll = slide * $row.clientWidth;
		}

		if ($row === $row1) {
			localStorage.quickToolRow1ScrollLeft = scroll;
		} else {
			localStorage.quickToolRow2ScrollLeft = scroll;
		}

		$row.scrollLeft = scroll;
		touchcancel(e);

		if ($el === $touchstart && performance.now() - startTime < 100) {
			click($el);
		}
		return;
	}

	if ($touchstart !== $el || contextmenu) {
		touchcancel(e);
		return;
	}

	touchcancel(e);
	click($el);
}

/**
 *
 * @param {TouchEvent} e
 */
function touchcancel(e) {
	document.removeEventListener("keyup", touchcancel);
	document.removeEventListener("touchend", touchend);
	document.removeEventListener("touchcancel", touchcancel);
	document.removeEventListener("touchmove", touchmove);
	clearTimeout(timeout);
	clearTimeout(contextmenuTimeout);
	if (!active) $touchstart.classList.remove("active");
}

/**
 * Handler for contextmenu event
 * @param {TouchEvent|MouseEvent} e
 */
function oncontextmenu(e) {
	const $el = e.target;
	const { lock } = $el.dataset;

	if (lock === "true") {
		return; // because button with lock=true is locked when clicked so contextmenu doesn't make sense
	}

	const { editor, activeFile } = editorManager;

	if (isClickMode && appSettings.value.vibrateOnTap) {
		navigator.vibrate(constants.VIBRATION_TIME_LONG);
		$el.classList.add("active");
	}

	const dispatchEventWithTimeout = () => {
		if (time > 50) {
			time -= 10;
		}
		click($el);
		timeout = setTimeout(dispatchEventWithTimeout, time);
	};

	if (activeFile.focused) {
		editor.focus();
	}
	dispatchEventWithTimeout();
}

/**
 * Executes the action associated with the button
 * @param {HTMLElement} $el
 */
function click($el) {
	$el.classList.add("click");
	clearTimeout($el.dataset.timeout);
	$el.dataset.timeout = setTimeout(() => {
		$el.classList.remove("click");
	}, 300);
	const { action } = $el.dataset;
	if (!action) return;

	let { value } = $el.dataset;

	if (!value) {
		value = $el.value;
	}

	actions(action, value);
}
