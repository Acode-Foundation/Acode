import "./style.scss";
import toast from "components/toast";
import Ref from "html-tag-js/ref";
import actionStack from "lib/actionStack";
import auth, { loginEvents } from "lib/auth";
import constants from "lib/constants";

let $sidebar;
/**@type {Array<(el:HTMLElement)=>boolean>} */
let preventSlideTests = [];

const events = {
	show: [],
	hide: [],
};

/**
 * @typedef {object} SideBar
 * @extends HTMLElement
 * @property {function():void} hide
 * @property {function():void} toggle
 * @property {function():void} onshow
 */

/**
 * Create a sidebar
 * @param {HTMLElement} [$container] - the element that will contain the sidebar
 * @param {HTMLElement} [$toggler] - the element that will toggle the sidebar
 * @returns {Sidebar}
 */
function create($container, $toggler) {
	let { innerWidth } = window;

	const START_THRESHOLD = constants.SIDEBAR_SLIDE_START_THRESHOLD_PX; //Point where to start swipe
	const MIN_WIDTH = 200; //Min width of the side bar
	const MAX_WIDTH = () => innerWidth * 0.7; //Max width of the side bar
	const resizeBar = Ref();
	const userAvatar = Ref();
	const userContextMenu = Ref();

	$container = $container || app;
	let mode = innerWidth > 600 ? "tab" : "phone";
	let width = +(localStorage.sideBarWidth || MIN_WIDTH);

	const eventOptions = { passive: false };
	const $el = (
		<div id="sidebar" className={mode}>
			<div className="apps">
				<div className="app-icons-container"></div>
				<div
					ref={userAvatar}
					className="user-icon-container"
					onclick={handleUserIconClick}
				>
					<span className="icon account_circle"></span>
				</div>
			</div>
			<div className="container"></div>
			<div
				className="resize-bar w-resize"
				onmousedown={onresize}
				ontouchstart={onresize}
			></div>

			<div ref={userContextMenu} className="user-menu">
				<div className="user-menu-header">
					<div className="user-menu-name"></div>
					<div className="user-menu-email"></div>
				</div>
				{/* <div className="user-menu-separator"></div> */}
				<div className="user-menu-item" onclick={handleLogout}>
					<span className="icon logout"></span>
					{strings.logout}
				</div>
			</div>
		</div>
	);
	const mask = <span className="mask" onclick={hide}></span>;
	const touch = {
		startX: 0,
		totalX: 0,
		endX: 0,
		startY: 0,
		totalY: 0,
		endY: 0,
		target: null,
	};
	let openedFolders = [];
	let resizeTimeout = null;
	let setWidthTimeout = null;

	$toggler?.addEventListener("click", toggle);
	$container.addEventListener("touchstart", ontouchstart, eventOptions);
	window.addEventListener("resize", onWindowResize);

	if (mode === "tab" && localStorage.sidebarShown === "1") {
		show();
	}

	loginEvents.on(() => {
		updateSidebarAvatar();
	});

	async function handleUserIconClick(e) {
		try {
			const isLoggedIn = await auth.isLoggedIn();

			if (!isLoggedIn) {
				auth.openLoginUrl();
			} else {
				toggleUserMenu();
			}
		} catch (error) {
			console.error("Error checking login status:", error);
			toast("Error checking login status", 3000);
		}
	}

	function toggleUserMenu() {
		const menu = userContextMenu.el;
		const isActive = menu.classList.toggle("active");

		if (isActive) {
			// Populate user info
			updateUserMenuInfo();

			// Add click outside listener
			setTimeout(() => {
				document.addEventListener("click", handleClickOutside);
			}, 10);
		} else {
			document.removeEventListener("click", handleClickOutside);
		}
	}

	function handleClickOutside(e) {
		if (
			!userContextMenu.el.contains(e.target) &&
			e.target !== userAvatar.el &&
			!userAvatar.el.contains(e.target)
		) {
			userContextMenu.el.classList.remove("active");
			document.removeEventListener("click", handleClickOutside);
		}
	}

	async function updateUserMenuInfo() {
		try {
			const userInfo = await auth.getUserInfo();
			if (userInfo) {
				const menuName = userContextMenu.el.querySelector(".user-menu-name");
				const menuEmail = userContextMenu.el.querySelector(".user-menu-email");
				menuName.textContent = userInfo.name || "Anonymous";
				if (userInfo.isAdmin) {
					menuName.innerHTML += ' <span class="badge">Admin</span>';
				}
				menuEmail.textContent = userInfo.email || "";
			}
		} catch (error) {
			console.error("Error fetching user info:", error);
		}
	}

	async function handleLogout() {
		try {
			const success = await auth.logout();
			if (success) {
				userContextMenu.el.classList.remove("active");
				document.removeEventListener("click", handleClickOutside);
				toast("Logged out successfully");
				updateSidebarAvatar();
			} else {
				toast("Failed to logout");
			}
		} catch (error) {
			console.error("Error during logout:", error);
		}
	}

	async function updateSidebarAvatar() {
		const avatarUrl = await auth.getAvatar();
		// Remove existing icon or avatar
		const existingIcon = userAvatar.el.querySelector(".icon");
		const existingAvatar = userAvatar.el.querySelector(".avatar");

		if (existingIcon) {
			existingIcon.remove();
		}
		if (existingAvatar) {
			existingAvatar.remove();
		}

		if (avatarUrl?.startsWith("data:") || avatarUrl?.startsWith("http")) {
			// Create and add avatar image
			const avatarImg = document.createElement("img");
			avatarImg.className = "avatar";
			avatarImg.src = avatarUrl;
			userAvatar.append(avatarImg);
		} else {
			// Fallback to default icon
			const defaultIcon = document.createElement("span");
			defaultIcon.className = "icon account_circle";
			userAvatar.append(defaultIcon);
		}
	}

	function onWindowResize() {
		clearTimeout(resizeTimeout);
		resizeTimeout = setTimeout(() => {
			const { innerWidth: currentWidth } = window;
			if (innerWidth === currentWidth) return;
			hide(true);
			innerWidth = currentWidth;
			$el.classList.remove(mode);
			mode = innerWidth > 750 ? "tab" : "phone";
			$el.classList.add(mode);
		}, 300);
	}

	function toggle() {
		if ($el.activated) return hide(true);
		show();
	}

	function show() {
		localStorage.sidebarShown = 1;
		$el.activated = true;
		$el.onclick = null;

		if (mode === "phone") {
			resizeBar.style.display = "none";
			$el.onshow();
			app.append($el, mask);
			$el.classList.add("show");
			document.ontouchstart = ontouchstart;

			actionStack.push({
				id: "sidebar",
				action: hideMaster,
			});
		} else {
			setWidth(width);
			resizeBar.style.display = "block";
			app.append($el);
			$el.onclick = () => {
				if (!$el.textContent) acode.exec("open-folder");
			};
		}
		onshow();
	}

	function hide(hideIfTab = false) {
		localStorage.sidebarShown = 0;
		if (mode === "phone") {
			actionStack.remove("sidebar");
			hideMaster();
		} else if (hideIfTab) {
			$el.activated = false;
			root.style.removeProperty("margin-left");
			root.style.removeProperty("width");
			$el.remove();
			editorManager.editor.resize(true);
		}
	}

	function hideMaster() {
		$el.style.transform = null;
		$el.classList.remove("show");
		setTimeout(() => {
			$el.activated = false;
			mask.remove();
			$el.remove();
			$container.style.overflow = null;
			onhide();
		}, 300);
		document.ontouchstart = null;
		resetState();

		openedFolders.map(($) => ($.onscroll = null));
		openedFolders = [];
	}

	async function onshow() {
		if ($el.onshow) $el.onshow.call($el);
		events.show.forEach((fn) => fn());

		// try {
		// 	if (await auth.isLoggedIn()) {
		// 		const avatar = await auth.getAvatar();
		// 		if (avatar) {
		// 			auth.updateSidebarAvatar(avatar);
		// 		}
		// 	}
		// } catch (error) {
		// 	console.error("Error updating avatar:", error);
		// }
	}

	function onhide() {
		if ($el.onhide) $el.onhide.call($el);
		events.hide.forEach((fn) => fn());
	}

	/**
	 * Event handler for touchstart event
	 * @param {TouchEvent} e
	 */
	function ontouchstart(e) {
		const { target } = e;
		const { clientX, clientY } = getClientCoords(e);

		if (preventSlideTests.find((test) => test(target))) return;
		if (mode === "tab") return;

		$el.style.transition = "none";
		touch.startX = clientX;
		touch.startY = clientY;
		touch.target = target;

		if ($el.activated && !$el.contains(target) && target !== mask) {
			return;
		} else if (
			(!$el.activated && touch.startX > START_THRESHOLD) ||
			target === $toggler
		) {
			return;
		}

		document.addEventListener("touchmove", ontouchmove, eventOptions);
		document.addEventListener("touchend", ontouchend, eventOptions);
	}

	/**
	 * Event handler for resize event
	 * @param {MouseEvent | TouchEvent} e
	 * @returns
	 */
	function onresize(e) {
		const { clientX } = getClientCoords(e);
		let deltaX = 0;
		const onMove = (e) => {
			const { clientX: currentX } = getClientCoords(e);
			deltaX = currentX - clientX;
			resize(deltaX);
		};
		const onEnd = () => {
			const newWidth = width + deltaX;
			if (newWidth <= MIN_WIDTH) width = MIN_WIDTH;
			else if (newWidth >= MAX_WIDTH()) width = MAX_WIDTH();
			else width = newWidth;
			localStorage.sideBarWidth = width;
			document.removeEventListener("touchmove", onMove, eventOptions);
			document.removeEventListener("mousemove", onMove, eventOptions);
			document.removeEventListener("touchend", onEnd, eventOptions);
			document.removeEventListener("mouseup", onEnd, eventOptions);
			document.removeEventListener("mouseleave", onEnd, eventOptions);
			document.removeEventListener("touchcancel", onEnd, eventOptions);
		};
		document.addEventListener("touchmove", onMove, eventOptions);
		document.addEventListener("mousemove", onMove, eventOptions);
		document.addEventListener("touchend", onEnd, eventOptions);
		document.addEventListener("mouseup", onEnd, eventOptions);
		document.addEventListener("mouseleave", onEnd, eventOptions);
		document.addEventListener("touchcancel", onEnd, eventOptions);
		return;
	}

	/**
	 * Resize the sidebar
	 * @param {number} deltaX
	 * @returns
	 */
	function resize(deltaX) {
		const newWidth = width + deltaX;
		if (newWidth >= MAX_WIDTH()) return;
		if (newWidth <= MIN_WIDTH) return;
		setWidth(newWidth);
	}

	/**
	 * Event handler for touchmove event
	 * @param {TouchEvent} e
	 */
	function ontouchmove(e) {
		e.preventDefault();

		const { clientX, clientY } = getClientCoords(e);
		touch.endX = clientX;
		touch.endY = clientY;
		touch.totalX = touch.endX - touch.startX;
		touch.totalY = touch.endY - touch.startY;

		let width = $el.getWidth();

		if (
			!$el.activated &&
			touch.totalX < width &&
			touch.startX < START_THRESHOLD
		) {
			if (!$el.isConnected) {
				app.append($el, mask);
				$container.style.overflow = "hidden";
			}

			$el.style.transform = `translate3d(${-(width - touch.totalX)}px, 0, 0)`;
		} else if (touch.totalX < 0 && $el.activated) {
			$el.style.transform = `translate3d(${touch.totalX}px, 0, 0)`;
		}
	}

	/**
	 * Event handler for touchend event
	 * @param {TouchEvent} e
	 */
	function ontouchend(e) {
		if (e.target !== mask && touch.totalX === 0) return resetState();
		else if (e.target === mask && touch.totalX === 0) return hide();
		e.preventDefault();

		const threshold = $el.getWidth() / 3;

		if (
			($el.activated && touch.totalX > -threshold) ||
			(!$el.activated && touch.totalX >= threshold)
		) {
			lclShow();
		} else if (
			(!$el.activated && touch.totalX < threshold) ||
			($el.activated && touch.totalX <= -threshold)
		) {
			hide();
		}

		function lclShow() {
			onshow();
			$el.activated = true;
			$el.style.transform = `translate3d(0, 0, 0)`;
			document.addEventListener("touchstart", ontouchstart, eventOptions);
			actionStack.remove("sidebar");
			actionStack.push({
				id: "sidebar",
				action: hideMaster,
			});
			resetState();
		}
	}

	/**
	 * Reset the touch state
	 */
	function resetState() {
		touch.totalY = 0;
		touch.startY = 0;
		touch.endY = 0;
		touch.totalX = 0;
		touch.startX = 0;
		touch.endX = 0;
		touch.target = null;
		$el.style.transition = null;
		document.removeEventListener("touchmove", ontouchmove, eventOptions);
		document.removeEventListener("touchend", ontouchend, eventOptions);
	}

	/**
	 * Set the width of the sidebar
	 * @param {number} width
	 */
	function setWidth(width) {
		$el.style.transition = "none";
		$el.style.maxWidth = width + "px";
		root.style.marginLeft = width + "px";
		root.style.width = `calc(100% - ${width}px)`;
		clearTimeout(setWidthTimeout);
		setWidthTimeout = setTimeout(() => {
			editorManager?.editor?.resize(true);
		}, 300);
	}

	/**
	 * Get the clientX and clientY from the event
	 * @param {TouchEvent | MouseEvent} e
	 * @returns {{clientX: number, clientY: number}}
	 */
	function getClientCoords(e) {
		const { clientX, clientY } = (e.touches ?? [])[0] ?? e;
		return { clientX, clientY };
	}

	$el.show = show;
	$el.hide = hide;
	$el.toggle = toggle;
	$el.onshow = () => {};
	$el.getWidth = function () {
		const width = innerWidth * 0.7;
		return mode === "phone" ? (width >= 350 ? 350 : width) : MIN_WIDTH;
	};

	return $el;
}

/**
 * Create a sidebar or return the existing one
 * @param {object} [arg0] - the element that will activate the sidebar
 * @param {HTMLElement} [arg0.container] - the element that will contain the sidebar
 * @param {HTMLElement} [arg0.toggler] - the element that will toggle the sidebar
 * @returns {HTMLElement & SideBar}
 */
function Sidebar({ container, toggler }) {
	$sidebar = $sidebar ?? create(container, toggler);
	return $sidebar;
}

Sidebar.hide = () => $sidebar?.hide();
Sidebar.show = () => $sidebar?.show();
Sidebar.toggle = () => $sidebar?.toggle();

Sidebar.on = (
	/**@type {'hide'|'show'} */ event,
	/**@type {Function} */ callback,
) => {
	if (!events[event]) return;
	events[event].push(callback);
};

Sidebar.off = (
	/**@type {'hide'|'show'} */ event,
	/**@type {Function} */ callback,
) => {
	if (!events[event]) return;
	events[event] = events[event].filter((cb) => cb !== callback);
};

/**@type {HTMLElement} */
Sidebar.el = null;

Object.defineProperty(Sidebar, "el", {
	get() {
		return $sidebar;
	},
});

preventSlideTests.push((target) => {
	let lastEl;
	return testScrollable(target.closest(".scroll"));

	/**
	 * Test if the element is scrollable recursively
	 * @param {HTMLElement} container
	 * @returns
	 */
	function testScrollable(container) {
		if (!container || container === lastEl) return false;

		const { scrollHeight, offsetHeight, scrollWidth, offsetWidth } = container;

		if (scrollHeight > offsetHeight) return true;
		if (scrollWidth > offsetWidth) return true;

		lastEl = container;

		return testScrollable(container.parentElement.closest(".scroll"));
	}
});

preventSlideTests.push((target) => {
	return (
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target.contentEditable === "true"
	);
});

export default Sidebar;

/**
 * Prevent the sidebar from sliding when the test returns true
 * @param {(target:Element)=>boolean} test
 */
export function preventSlide(test) {
	preventSlideTests.push(test);
}
