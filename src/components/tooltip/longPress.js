/** One delegated listener set, including icon controls inside open ShadowRoots. */
export function installIconTooltips(root, show, hide) {
	let press, timer, suppressed, observer;
	let shadowRoots = [];
	const pointers = new Set();
	const labelOf = (node) =>
		["data-label", "aria-label", "title"]
			.map((name) => node.getAttribute(name)?.trim())
			.find(Boolean);
	const targetOf = (event) => {
		const path = event.composedPath();
		// Quicktools already own their tooltip, repeat and modifier gestures.
		if (path.some((node) => node?.id === "quick-tools")) return;
		return path.find(
			(node) =>
				node?.matches?.("button, [role='button'], .icon") && labelOf(node),
		);
	};
	function dismiss() {
		clearTimeout(timer);
		press = undefined;
		observer?.disconnect();
		observer = undefined;
		for (const shadow of shadowRoots)
			shadow.removeEventListener("scroll", dismiss, true);
		shadowRoots = [];
		hide();
	}
	function down(event) {
		pointers.add(event.pointerId);
		dismiss();
		suppressed = undefined;
		if (pointers.size !== 1 || event.button !== 0) return;
		const target = targetOf(event);
		if (!target) return;
		// Element scroll events do not cross a shadow boundary.
		shadowRoots = event
			.composedPath()
			.filter((node) => node?.nodeType === 11 && node.host);
		for (const shadow of shadowRoots)
			shadow.addEventListener("scroll", dismiss, true);
		press = { target, x: event.clientX, y: event.clientY, held: false };
		timer = setTimeout(() => {
			if (!press || !target.isConnected) return;
			press.held = true;
			show(target, labelOf(target), target.dataset.description);
			observer = new MutationObserver(() => {
				if (!target.isConnected) dismiss();
			});
			// Also observe removal of the tab's host, including nested shadow hosts.
			for (const boundary of [root, ...shadowRoots])
				observer.observe(boundary, { childList: true, subtree: true });
		}, 500);
	}
	function move(event) {
		if (
			press &&
			Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10
		)
			dismiss();
	}
	function up(event) {
		pointers.delete(event.pointerId);
		clearTimeout(timer);
		if (press?.held)
			suppressed = { target: press.target, until: Date.now() + 750 };
		press = undefined;
	}
	function cancel(event) {
		pointers.delete(event.pointerId);
		dismiss();
	}
	function click(event) {
		if (
			event.detail &&
			suppressed &&
			suppressed.target === targetOf(event) &&
			Date.now() < suppressed.until
		) {
			event.preventDefault();
			event.stopImmediatePropagation();
		}
		suppressed = undefined;
	}
	function contextmenu(event) {
		// A control's own menu wins over the shared tooltip.
		if (event.defaultPrevented) {
			dismiss();
			return;
		}
		if (press?.held && press.target === targetOf(event)) event.preventDefault();
	}
	function reset() {
		pointers.clear();
		suppressed = undefined;
		dismiss();
	}
	const events = {
		pointerdown: down,
		pointermove: move,
		pointerup: up,
		pointercancel: cancel,
		click,
		scroll: dismiss,
		keydown: dismiss,
	};
	for (const [name, handler] of Object.entries(events))
		root.addEventListener(name, handler, true);
	root.addEventListener("contextmenu", contextmenu);
	const viewport = root.defaultView?.visualViewport;
	root.defaultView?.addEventListener("blur", reset);
	viewport?.addEventListener("resize", dismiss);
	viewport?.addEventListener("scroll", dismiss);
	return {
		dismiss: reset,
		dispose() {
			reset();
			for (const [name, handler] of Object.entries(events))
				root.removeEventListener(name, handler, true);
			root.removeEventListener("contextmenu", contextmenu);
			root.defaultView?.removeEventListener("blur", reset);
			viewport?.removeEventListener("resize", dismiss);
			viewport?.removeEventListener("scroll", dismiss);
		},
	};
}
