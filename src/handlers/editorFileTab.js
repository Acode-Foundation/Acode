import config from "lib/config";
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
/**
 * The original next sibling of the dragged tab.
 * @type {Element|null}
 */
let initialNextSibling = null;
let didReorder = false;

const MAX_SCROLL_SPEED = 4;
const REORDER_DURATION = 280;
const RELEASE_DURATION = 250;
const SPRING_EASING = "cubic-bezier(0.2, 1.2, 0.4, 1)";

/** @type {WeakMap<HTMLElement, Animation>} */
const reorderAnimations = new WeakMap();

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
		navigator.vibrate(config.VIBRATION_TIME);
	}

	$tab = e.target;
	$parent = $tab.parentElement;
	$tabClone = $tab.cloneNode(true);
	initialNextSibling = $tab.nextElementSibling;
	didReorder = false;

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
	$tab.style.opacity = "0.35";
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
	updateDragPreview(clientX, clientY);

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
	const shouldCommitReorder = $parent.contains($target);

	if (shouldCommitReorder) {
		updateDragPreview(clientX, clientY);
		if (didReorder) {
			updateFileList($parent);
		}
	} else if (
		$target &&
		($target.tagName === "INPUT" ||
			$target.tagName === "TEXTAREA" ||
			$target.isContentEditable ||
			$target.closest(".cm-editor"))
	) {
		// If released on an input area or CodeMirror editor
		const filePath = editorManager.activeFile.uri;
		if (filePath) {
			if ($target.closest(".cm-editor")) {
				const view = editorManager.editor;
				view.dispatch(view.state.replaceSelection(filePath));
			} else {
				$target.value += filePath;
			}
		}
	}

	const shouldSettleClone = shouldCommitReorder || didReorder;

	if (!shouldCommitReorder && didReorder) {
		restoreInitialTabPosition();
	}

	finishDrag(shouldSettleClone);
}

function finishDrag(shouldSettleClone) {
	cancelAnimationFrame(animationFrame);

	document.removeEventListener("mousemove", onDrag, opts);
	document.removeEventListener("touchmove", onDrag, opts);
	document.removeEventListener("mouseup", releaseDrag, opts);
	document.removeEventListener("touchend", releaseDrag, opts);
	document.removeEventListener("touchcancel", releaseDrag, opts);
	document.removeEventListener("mouseleave", releaseDrag, opts);

	$parent.removeEventListener("scroll", preventDefaultScroll);

	if (shouldSettleClone) {
		const rect = $tab.getBoundingClientRect();
		const anim = $tabClone.animate(
			[{ transform: `translate3d(${rect.left}px, ${rect.top}px, 0)` }],
			{ duration: RELEASE_DURATION, easing: SPRING_EASING, fill: "forwards" },
		);
		anim.onfinish = cleanupDrag;
		anim.oncancel = cleanupDrag;
		return;
	}

	cleanupDrag();
}

function cleanupDrag() {
	$tab.style.opacity = "";
	$tabClone.remove();
	$tabClone = null;
	initialNextSibling = null;
	didReorder = false;
}

function preventDefaultScroll() {
	this.scrollLeft = prevScrollLeft;
}

function updateDragPreview(clientX, clientY) {
	const $target = document.elementFromPoint(clientX, clientY);
	if (
		!$parent.contains($target) ||
		$target === $tab ||
		$tab.contains($target)
	) {
		return;
	}

	const $targetTab = $target.closest(".tile");
	if (!$targetTab) return;

	const rect = $targetTab.getBoundingClientRect();
	const midX = rect.left + rect.width / 2;
	const pointerX = tabLeft + tabWidth / 2;
	const $nextSibling = $targetTab.nextElementSibling;
	const $insertBefore = midX < pointerX ? $nextSibling : $targetTab;

	if ($insertBefore === $tab || $tab.nextElementSibling === $insertBefore)
		return;

	reorderTab($insertBefore);
	didReorder = true;
}

function restoreInitialTabPosition() {
	reorderTab(
		initialNextSibling?.parentElement === $parent ? initialNextSibling : null,
	);
}

function reorderTab($insertBefore) {
	const previousRects = captureVisualPositions($parent);

	if ($insertBefore) {
		$parent.insertBefore($tab, $insertBefore);
	} else {
		$parent.appendChild($tab);
	}

	animateTabReorder($parent, previousRects);
}

/**
 * Captures where each tab visually is right now (including mid-animation
 * transforms via WAAPI), so the FLIP delta is calculated from the visual
 * position rather than the DOM layout position.
 * @param {HTMLElement} $parent
 * @returns {Map<HTMLElement, DOMRect>}
 */
function captureVisualPositions($parent) {
	return new Map(
		[...$parent.children].map(($child) => [
			$child,
			$child.getBoundingClientRect(),
		]),
	);
}

/**
 * Animates the visual change after the DOM order is updated using FLIP.
 * Uses WAAPI directly for reliable mid-animation compositing and to
 * properly respect the app's no-animation setting.
 * @param {HTMLElement} $parent
 * @param {Map<HTMLElement, DOMRect>} previousRects
 */
function animateTabReorder($parent, previousRects) {
	for (const $child of $parent.children) {
		if ($child === $tab) continue;

		const oldAnim = reorderAnimations.get($child);
		if (oldAnim) {
			oldAnim.cancel();
			reorderAnimations.delete($child);
		}

		const previousRect = previousRects.get($child);
		if (!previousRect) continue;

		const currentRect = $child.getBoundingClientRect();
		const deltaX = previousRect.left - currentRect.left;
		const deltaY = previousRect.top - currentRect.top;

		if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) continue;

		const anim = $child.animate(
			[
				{ transform: `translate3d(${deltaX}px, ${deltaY}px, 0)` },
				{ transform: "translate3d(0, 0, 0)" },
			],
			{
				duration: REORDER_DURATION,
				easing: SPRING_EASING,
				fill: "none",
				composite: "replace",
			},
		);
		reorderAnimations.set($child, anim);

		anim.onfinish = () => {
			if (reorderAnimations.get($child) === anim) {
				reorderAnimations.delete($child);
			}
		};
		anim.oncancel = () => {
			if (reorderAnimations.get($child) === anim) {
				reorderAnimations.delete($child);
			}
		};
	}
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
	const pinnedCount = editorManager.files.filter((file) => file.pinned).length;
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

	const draggedFile = newFileList.find((file) => file.tab === $tab);
	if (draggedFile) {
		const draggedIndex = newFileList.indexOf(draggedFile);
		let nextPinnedState;

		if (!draggedFile.pinned && draggedIndex < pinnedCount) {
			nextPinnedState = true;
		} else if (draggedFile.pinned && draggedIndex >= pinnedCount) {
			nextPinnedState = false;
		}

		if (nextPinnedState !== undefined) {
			draggedFile.setPinnedState(nextPinnedState, { reorder: false });
			if (typeof editorManager.normalizePinnedTabOrder === "function") {
				editorManager.normalizePinnedTabOrder(editorManager.files);
			}
		}
	}
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
