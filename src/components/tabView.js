import Ref from "html-tag-js/ref";
import { animate } from "motion";

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

	// Initialize the tab indicator after rendering
	requestAnimationFrame(() => {
		const $options = el.get?.(".options");
		if (!$options) return;

		let $indicator = $options.querySelector(".tab-indicator");
		if (!$indicator) {
			$indicator = <div className="tab-indicator"></div>;
			$options.append($indicator);
		}

		const update = () => {
			const $active = $options.querySelector(".active");
			if ($active) {
				const targetTransform = `translateX(${$active.offsetLeft}px) scaleX(${$active.offsetWidth})`;
				animate(
					$indicator,
					{
						transform: targetTransform,
					},
					{
						type: "spring",
						stiffness: 380,
						damping: 30,
					},
				).then(() => {
					$indicator.style.transform = targetTransform;
				});
			}
		};

		// Initial positioning
		update();

		// Observe changes to 'class' attribute of child tab spans
		const observer = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				if (
					mutation.type === "attributes" &&
					mutation.attributeName === "class" &&
					mutation.target.classList.contains("active")
				) {
					update();
					break;
				}
			}
		});

		observer.observe($options, {
			attributes: true,
			childList: false,
			subtree: true,
			attributeFilter: ["class"],
		});

		const connectionObserver = new MutationObserver(() => {
			if (!el.el.isConnected) {
				observer.disconnect();
				connectionObserver.disconnect();
			}
		});

		connectionObserver.observe(document.body || document.documentElement, {
			childList: true,
			subtree: true,
		});

		if (!el.el.isConnected) {
			observer.disconnect();
			connectionObserver.disconnect();
		}
	});

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

		document.addEventListener("touchmove", omtouchmove, { passive: false });
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
			const tabs = Array.from(el.get(".options").children).filter((child) =>
				child.matches("span"),
			);
			const currentTab = el.get(".options>span.active");
			const direction = moveX > 0 ? 1 : -1;
			const currentTabIndex = tabs.indexOf(currentTab);
			const nextTabIndex =
				(currentTabIndex + direction + tabs.length) % tabs.length;
			const nextTab = tabs[nextTabIndex];
			nextTab.click();
			if (currentTab) currentTab.classList.remove("active");
			nextTab.classList.add("active");
		}
	}

	function changeTab(e) {
		const { target } = e;
		if (!target.matches(".options>span")) return;
		const currentTab = el.get(".options>span.active");
		if (target === currentTab) return;
		if (currentTab) currentTab.classList.remove("active");
		target.classList.add("active");
	}
}
