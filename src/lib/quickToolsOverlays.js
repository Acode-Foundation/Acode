// Native dialogs and menus are direct children of body or the app container.
// Never observe editor content (including an adapter's ShadowRoot/iframe).
const containers = () =>
	[globalThis.document?.body, globalThis.app].filter(
		(node, index, nodes) =>
			node?.nodeType === 1 && nodes.indexOf(node) === index,
	);
export function hasQuickToolsOverlay() {
	return containers().some((root) =>
		[...root.children].some((node) =>
			node.matches(".prompt, #palette, .context-menu, .mask"),
		),
	);
}

export function watchQuickToolsOverlays(registry, cancelInput) {
	let watching = false,
		wasBlocked = false;
	const update = () => {
		const blocked = hasQuickToolsOverlay();
		if (blocked && !wasBlocked) cancelInput();
		wasBlocked = blocked;
		registry.setBlocked(blocked);
	};
	const observer = new MutationObserver(update);
	const sync = () => {
		const active = registry.has();
		if (active === watching) return;
		watching = active;
		if (active) {
			for (const node of containers())
				observer.observe(node, { childList: true });
			document.addEventListener("focusin", update, true);
			document.addEventListener("pointerdown", update, true);
			update();
		} else {
			wasBlocked = false;
			observer.disconnect();
			document.removeEventListener("focusin", update, true);
			document.removeEventListener("pointerdown", update, true);
			registry.setBlocked(false);
		}
	};
	const unsubscribe = registry.subscribe(sync);
	sync();
	return () => {
		unsubscribe();
		observer.disconnect();
		document.removeEventListener("focusin", update, true);
		document.removeEventListener("pointerdown", update, true);
		registry.setBlocked(false);
	};
}
