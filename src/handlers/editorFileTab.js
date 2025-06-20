import constants from "lib/constants";
import settings from "lib/settings";

const opts = { passive: false };

/**
 * Clone of tab being dragged
 * @type {HTMLDivElement}
 */
let $tabClone = null;
/**
 * Selected tab element
 * @type {HTMLDivElement}
 */
let $tab = null;
/**
 * Tab container element
 * @type {HTMLDivElement}
 */
let $parent = null;

let MAX_SCROLL = 0;
let MIN_SCROLL = 0;

/**
 * Cached tab top position to avoid dom access
 * @type {number}
 */
let tabTop = 0;
/**
 * Cached tab left position to avoid dom access
 * @type {number}
 */
let tabLeft = 0;
/**
 * Stores the offset of tab from pointer
 * @type {number}
 */
let offsetX = 0;
/**
 * Stores the offset of tab from pointer
 * @type {number}
 */
let offsetY = 0;
/**
 * Caches the width of tab to avoid dom access
 * @type {number}
 */
let tabWidth = 0;
/**
 * Caches the left position of parent to avoid dom access
 * @type {number}
 */
let parentLeft = 0;
/**
 * Caches the right position of parent to avoid dom access
 * @type {number}
 */
let parentRight = 0;
/**
 * Animation frame id
 * @type {number}
 */
let animationFrame = null;
/**
 * @type {number}
 */
let prevScrollLeft = 0;

const MAX_SCROLL_SPEED = 4;

/**
 * Handles file drag
 * @param {MouseEvent} e
 */
export default function startDrag(e) {
	const { clientX, clientY } = getClientPos(e);
	const { editor, activeFile } = editorManager;

	if (activeFile.focusedBefore) {
		editor.focus();
	}

	if (settings.value.vibrateOnTap) {
		navigator.vibrate(constants.VIBRATION_TIME);
	}

	$tab = e.target;
	$parent = $tab.parentElement;
	$tabClone = $tab.cloneNode(true);

	const rect = $tab.getBoundingClientRect();
	const parentRect = $parent.getBoundingClientRect();

	/**
	 * Setting offset of tab from pointer
	 * this is used to set the position of tab when dragging
	 * so tab moves with pointer but not snapped to top left corner
	 * of the tab because setting translate will move the tab to
	 * clientX, clientY position, it's like virtual transform origin.
	 *
	 * (rect.x, rect.y) is the position of the tab
	 *     __________________
	 *    |    * (pointer)   | clientY - rect.y
	 *    |__________________|
	 *    <----> clientX - rect.x
	 */
	offsetX = clientX - rect.x;
	offsetY = clientY - rect.y;

	tabLeft = rect.left;
	tabWidth = rect.width;
	parentLeft = parentRect.left;
	parentRight = parentRect.right;

	MAX_SCROLL = $parent.scrollWidth - parentRect.width;
	MIN_SCROLL = 0;

	// setup the cloned tab
	$tabClone.classList.add("drag");
	$tabClone.style.height = `${rect.height}px`;
	$tabClone.style.width = `${rect.width}px`;
	$tabClone.style.transform = `translate3d(${rect.x}px, ${rect.y}px, 0)`;
	app.append($tabClone);
	$tab.click();

	document.addEventListener("mousemove", onDrag, opts);
	document.addEventListener("touchmove", onDrag, opts);
	document.addEventListener("mouseup", releaseDrag, opts);
	document.addEventListener("touchend", releaseDrag, opts);
	document.addEventListener("touchcancel", releaseDrag, opts);
	document.addEventListener("mouseleave", releaseDrag, opts);

	prevScrollLeft = $parent.scrollLeft;
	$parent.addEventListener("scroll", preventDefaultScroll, opts);
}

/**
 * On mouse or touch move
 * @param {MouseEvent|TouchEvent} e
 * @returns
 */
function onDrag(e) {
	if (e instanceof Event) {
		e.preventDefault();
		e.stopPropagation();
		e.stopImmediatePropagation();
	}

	const { clientX, clientY } = getClientPos(e);

	tabLeft = clientX - offsetX;
	tabTop = clientY - offsetY;

	$tabClone.style.transform = `translate3d(${tabLeft}px, ${tabTop}px, 0)`;

	if ($parent.scrollWidth === $parent.clientWidth) return;

	const scroll = getScroll();
	// if can scroll and already scrolling return
	// or if can't scroll and not scrolling return
	if (!!scroll === !!animationFrame) return;
	// if can't scroll and scrolling clear interval
	if (!scroll && animationFrame) {
		cancelAnimationFrame(animationFrame);
		animationFrame = null;
		return;
	}

	scrollContainer();
}

/**
 * Cancels the drag
 * @param {MouseEvent} e
 */
function releaseDrag(e) {
	const { clientX, clientY } = getClientPos(e);

	/**@type {HTMLDivElement} target tab */
	const $target = document.elementFromPoint(clientX, clientY);

	if (
		$parent.contains($target) && // target is in parent
		$target !== $tab && // target is not the tab
		!$tab.contains($target) // target is not a child of tab
	) {
		// get the target tab, if target is a child it will get the parent
		const $targetTab = $target.closest(".tile");

		if ($targetTab) {
			const rect = $targetTab.getBoundingClientRect();
			const midX = rect.left + rect.width / 2;
			const pointerX = tabLeft + tabWidth / 2;
			if (midX < pointerX) {
				// move right
				const $nextSibling = $targetTab.nextElementSibling;
				if ($nextSibling) {
					$parent.insertBefore($tab, $nextSibling);
				} else {
					$parent.appendChild($tab);
				}
			} else {
				$parent.insertBefore($tab, $targetTab);
			}
			updateFileList($parent);
		}
	} else if (
		$target.tagName === "INPUT" ||
		$target.tagName === "TEXTAREA" ||
		$target.classList.contains("ace_text-input") ||
		$target.closest(".ace_editor")
	) {
		// If released on an input area or ace editor
		const filePath = editorManager.activeFile.uri;
		if (filePath) {
			if ($target.closest(".ace_editor")) {
				editorManager.editor.insert(filePath);
			} else {
				$target.value += filePath;
			}
		}
	}

	cancelAnimationFrame(animationFrame);
	$tabClone.remove();
	$tabClone = null;

	document.removeEventListener("mousemove", onDrag, opts);
	document.removeEventListener("touchmove", onDrag, opts);
	document.removeEventListener("mouseup", releaseDrag, opts);
	document.removeEventListener("touchend", releaseDrag, opts);
	document.removeEventListener("touchcancel", releaseDrag, opts);
	document.removeEventListener("mouseleave", releaseDrag, opts);

	$parent.removeEventListener("scroll", preventDefaultScroll);
}

function preventDefaultScroll() {
	this.scrollLeft = prevScrollLeft;
}

/**
 * Scrolls the container using animation frame
 */
function scrollContainer() {
	return animate();

	function animate() {
		const scroll = getScroll();
		if (!scroll) return;
		prevScrollLeft = $parent.scrollLeft += scroll;
		animationFrame = requestAnimationFrame(animate);
	}
}

/**
 * Gets the client position from the event
 * @param {MouseEvent & TouchEvent} e
 * @returns {MouseEvent}
 */
function getClientPos(e) {
	const { touches, changedTouches } = e;

	let { clientX = 0, clientY = 0 } = e;

	if (touches?.length) {
		const [touch] = touches;
		clientX = touch.clientX;
		clientY = touch.clientY;
	} else if (changedTouches?.length) {
		const [touch] = changedTouches;
		clientX = touch.clientX;
		clientY = touch.clientY;
	}

	return { clientX, clientY };
}

/**
 * Update the position of the file list
 * @param {HTMLElement} $parent
 */
function updateFileList($parent) {
	const children = [...$parent.children];
	const newFileList = [];
	for (let el of children) {
		for (let file of editorManager.files) {
			if (file.tab === el) {
				newFileList.push(file);
				break;
			}
		}
	}

	editorManager.files = newFileList;
}

/**
 * Checks if the tab is going to scroll and returns the scroll value
 */
function getScroll() {
	const tabRight = tabLeft + tabWidth;
	const scrollX = $parent.scrollLeft;

	/**@type {number} scroll value */
	let scroll = 0;

	// tab right should be greater than parent right
	const rightDiff = tabRight - parentRight;
	// tab left should be less than parent left
	const leftDiff = parentLeft - tabLeft;

	const scrollSpeed = (diff) => {
		const ratio = diff / tabWidth;
		return ratio * MAX_SCROLL_SPEED;
	};

	if (leftDiff > 0 && scrollX > MIN_SCROLL) {
		scroll = -scrollSpeed(leftDiff);
	} else if (rightDiff > 0 && scrollX < MAX_SCROLL) {
		scroll = scrollSpeed(rightDiff);
	}

	return scroll;
}
