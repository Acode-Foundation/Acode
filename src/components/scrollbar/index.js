import "./style.scss";
import tag from "html-tag-js";

/**
 * @typedef {object} Scrollbar
 * @property {function():void} destroy
 * @property {function():void} render
 * @property {function():void} show
 * @property {function():void} hide
 * @property {function():void} resize
 * @property {function():void} onshow
 * @property {function():void} onhide
 * @property {function():void} hideImmediately
 * @property {number} value
 * @property {number} size
 * @property {boolean} visible
 */

/**
 * Create a scrollbar
 * @param {Object} options
 * @param {HTMLElement} [options.parent]
 * @param {"top"|"left"|"right"|"bottom"} [options.placement = "right"]
 * @param {Number} [options.width]
 * @param {function():void} [options.onscroll]
 * @param {function():void} [options.onscrollend]
 * @returns {Scrollbar & HTMLElement}
 */
export default function ScrollBar(options) {
	if (!options || !options.parent) {
		throw new Error("ScrollBar.js: Parent element required.");
	}

	const { placement = "right" } = options;
	const $cursor = tag("span", {
		className: "scroll-cursor",
		style: {
			top: 0,
			left: 0,
		},
	});
	const $thumb = tag("span", {
		className: "thumb",
	});
	const $container = tag("div", {
		className: "container",
		children: [$cursor, $thumb],
	});
	const $scrollbar = tag("div", {
		className: `scrollbar-container ${placement}`,
		child: $container,
	});
	const config = {
		passive: false,
	};
	const TIMEOUT = 2000;
	const isVertical = placement === "right" || placement === "left";
	const observer = new MutationObserver(observerCallback);
	let scroll = 0;
	const touchStartValue = {
		x: 0,
		y: 0,
	};
	let scrollbarSize = 20;
	let height;
	let width;
	let rect;
	let scrollbarTimeoutHide;
	let scrollbarTimeoutRemove;
	let onshow;
	let onhide;
	let touchStarted = false;

	if (options.width) scrollbarSize = options.width;

	setWidth(scrollbarSize);
	$scrollbar.onScroll = options.onscroll;
	$scrollbar.onScrollEnd = options.onscrollend;
	$thumb.addEventListener("touchstart", touchStart, config);
	$thumb.addEventListener("mousedown", touchStart, config);
	window.addEventListener("resize", resize);
	observer.observe($cursor, {
		attributes: true,
	});

	function observerCallback() {
		$thumb.style.top = $cursor.style.top;
		$thumb.style.left = $cursor.style.left;
	}

	function setWidth(width) {
		if (isVertical) $scrollbar.style.width = $cursor.style.width = `${width}px`;
		else $scrollbar.style.height = $cursor.style.height = `${width}px`;
	}

	/**
	 *
	 * @param {TouchEvent|MouseEvent} e
	 */
	function touchStart(e) {
		e.preventDefault();
		touchStarted = true;
		if (!rect) resize();
		const touch = e.type === "touchstart" ? e.touches[0] : e;
		touchStartValue.x = touch.clientX;
		touchStartValue.y = touch.clientY;
		$scrollbar.classList.add("active");
		document.addEventListener("touchmove", touchMove, config);
		document.addEventListener("mousemove", touchMove, config);
		document.addEventListener("touchend", touchEnd, config);
		document.addEventListener("mouseup", touchEnd, config);
		document.addEventListener("touchcancel", touchEnd, config);
		clearTimeout(scrollbarTimeoutHide);
	}

	/**
	 *
	 * @param {TouchEvent | MouseEvent} e
	 */
	function touchMove(e) {
		const touch = e.type === "touchmove" ? e.touches[0] : e;
		const touchDiffX = touchStartValue.x - touch.clientX;
		const touchDiffY = touchStartValue.y - touch.clientY;
		touchStartValue.x = touch.clientX;
		touchStartValue.y = touch.clientY;

		if (isVertical) {
			let top = Number.parseFloat($cursor.style.top) - touchDiffY;
			const currentTopValue = Number.parseFloat($cursor.style.top);

			if (top < 0) top = 0;
			else if (top > height) top = height;

			if (currentTopValue !== top) {
				$cursor.style.top = `${top}px`;
				scroll = top / height;
				if (typeof $scrollbar.onScroll === "function")
					$scrollbar.onScroll(scroll);
			}
		} else {
			let left = Number.parseFloat($cursor.style.left) - touchDiffX;
			const currentLeftValue = Number.parseFloat($cursor.style.left);

			if (left < 0) left = 0;
			else if (left > width) left = width;

			if (currentLeftValue !== left) {
				$cursor.style.left = `${left}px`;
				scroll = left / width;
				if (typeof $scrollbar.onScroll === "function")
					$scrollbar.onScroll(scroll);
			}
		}
	}

	/**
	 *
	 * @param {TouchEvent|MouseEvent} e
	 */
	function touchEnd(e) {
		e.preventDefault();
		touchStarted = false;
		$scrollbar.classList.remove("active");
		document.removeEventListener("touchmove", touchMove, config);
		document.removeEventListener("mousemove", touchMove, config);
		document.removeEventListener("touchend", touchEnd, config);
		document.removeEventListener("mouseup", touchEnd, config);
		document.removeEventListener("touchcancel", touchEnd, config);
		if (typeof $scrollbar.onScrollEnd === "function") $scrollbar.onScrollEnd();
		scrollbarTimeoutHide = setTimeout(hide, TIMEOUT);
	}

	function resize(render = true) {
		rect = $scrollbar.getBoundingClientRect();
		height = rect.height - 20;
		width = rect.width - 20;

		if (height < 0) height = 0;
		if (width < 0) width = 0;
		if (render && height && width) setValue(scroll);
	}

	function setValue(value) {
		if (!height || !width) resize(false);

		//Make sure value is between 0 and 1
		const boundedValue = Math.max(0, Math.min(1, value));

		scroll = boundedValue;
		if (isVertical) $cursor.style.top = `${boundedValue * height}px`;
		else $cursor.style.left = `${boundedValue * width}px`;
	}

	function destroy() {
		window.removeEventListener("resize", resize);
		$thumb.removeEventListener("touchstart", touchStart);
		observer.disconnect();
		if (typeof onhide === "function") onhide();
	}

	function render() {
		show();
		clearTimeout(scrollbarTimeoutHide);
		scrollbarTimeoutHide = setTimeout(hide, TIMEOUT);
	}

	function show() {
		if ($scrollbar.dataset.hidden === "false") {
			return;
		}
		$scrollbar.dataset.hidden = false;
		clearTimeout(scrollbarTimeoutHide);
		clearTimeout(scrollbarTimeoutRemove);
		$scrollbar.classList.remove("hide");
		if (!$scrollbar.isConnected) {
			options.parent.append($scrollbar);
			if (typeof onshow === "function") onshow();
		}
	}

	function hide() {
		if (touchStarted) return;
		$scrollbar.dataset.hidden = true;
		$scrollbar.classList.add("hide");
		scrollbarTimeoutRemove = setTimeout(() => $scrollbar.remove(), 300);
		if (typeof onhide === "function") onhide();
	}

	function hideImmediately() {
		$scrollbar.dataset.hidden = true;
		$scrollbar.classList.add("hide");
		$scrollbar.remove();
		if (typeof onhide === "function") onhide();
	}

	Object.defineProperty($scrollbar, "size", {
		get: () => scrollbarSize,
		set: setWidth,
	});

	Object.defineProperty($scrollbar, "resize", {
		value: resize,
	});

	Object.defineProperty($scrollbar, "value", {
		get: () => scroll,
		set: setValue,
	});

	Object.defineProperty($scrollbar, "destroy", {
		value: destroy,
	});

	Object.defineProperty($scrollbar, "render", {
		value: render,
	});

	Object.defineProperty($scrollbar, "show", {
		value: show,
	});

	Object.defineProperty($scrollbar, "hide", {
		value: hide,
	});

	Object.defineProperty($scrollbar, "visible", {
		get() {
			return this.dataset.hidden !== "true";
		},
	});

	Object.defineProperty($scrollbar, "onshow", {
		set(fun) {
			onshow = fun;
		},
		get() {
			return onshow;
		},
	});

	Object.defineProperty($scrollbar, "onhide", {
		set(fun) {
			onhide = fun;
		},
		get() {
			return onhide;
		},
	});

	Object.defineProperty($scrollbar, "hideImmediately", {
		value: hideImmediately,
	});

	return $scrollbar;
}
