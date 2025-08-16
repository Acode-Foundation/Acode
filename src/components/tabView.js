import Ref from "html-tag-js/ref";

/**
 *
 * @param {object} param0
 * @param {string} param0.id
 * @returns
 */
export default function TabView({ id, disableSwipe = false }, children) {
	let moveX = 0;
	let moveY = 0;
	let lastX = 0;
	let lastY = 0;
	let isScrolling = false;
	const el = Ref();
	return (
		<div
			ref={el}
			onclick={changeTab}
			ontouchstart={!disableSwipe ? ontouchstart : null}
			className="main"
			id={id}
		>
			{children}
		</div>
	);

	function ontouchstart(e) {
		moveX = 0;
		moveY = 0;
		lastX = e.touches[0].clientX;
		lastY = e.touches[0].clientY;
		isScrolling = false;

		document.addEventListener("touchmove", omtouchmove, { passive: true });
		document.addEventListener("touchend", omtouchend);
		document.addEventListener("touchcancel", omtouchend);
	}

	function omtouchmove(e) {
		const { clientX, clientY } = e.touches[0];
		const deltaX = lastX - clientX;
		const deltaY = lastY - clientY;

		// Determine if the user is primarily scrolling vertically
		if (!isScrolling) {
			isScrolling = Math.abs(deltaY) > Math.abs(deltaX);
		}

		if (!isScrolling) {
			moveX += deltaX;
			e.preventDefault();
		}

		lastX = clientX;
		lastY = clientY;
	}

	function omtouchend() {
		document.removeEventListener("touchmove", omtouchmove);
		document.removeEventListener("touchend", omtouchend);
		document.removeEventListener("touchcancel", omtouchend);

		// Only change tabs when a significant horizontal swipe is detected and not scrolling vertically
		if (!isScrolling && Math.abs(moveX) > 100) {
			const tabs = Array.from(el.get(".options").children);
			const currentTab = el.get(".options>span.active");
			const direction = moveX > 0 ? 1 : -1;
			const currentTabIndex = tabs.indexOf(currentTab);
			const nextTabIndex =
				(currentTabIndex + direction + tabs.length) % tabs.length;
			tabs[nextTabIndex].click();
			currentTab.classList.remove("active");
			tabs[nextTabIndex].classList.add("active");
		}
	}

	function changeTab(e) {
		const { target } = e;
		if (!target.matches(".options>span")) return;
		const currentTab = el.get(".options>span.active");
		if (target === currentTab) return;
		currentTab.classList.remove("active");
		target.classList.add("active");
	}
}
