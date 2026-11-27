const selector = "input, textarea, [contenteditable]";
const attributes = {
	autocorrect: "off",
	spellcheck: "false",
	writingsuggestions: "false",
};
const originals = new Map<Element, Map<string, string | null>>();
let observer: MutationObserver | undefined;

export default function setInputType(mode: unknown) {
	const disabled =
		mode === "NO_SUGGESTIONS" || mode === "NO_SUGGESTIONS_AGGRESSIVE";
	if (!disabled) {
		observer?.disconnect();
		observer = undefined;
		document.removeEventListener("focusin", onFocus, true);
		for (const element of originals.keys()) restore(element);
		return;
	}
	if (observer) return;
	apply(document.documentElement);
	observer = new MutationObserver((records) => {
		for (const element of originals.keys()) {
			if (!element.isConnected) restore(element);
		}
		for (const record of records) {
			if (record.type === "attributes") apply(record.target);
			else for (const node of record.addedNodes) apply(node);
		}
	});
	observer.observe(document.documentElement, {
		childList: true,
		subtree: true,
		attributes: true,
		attributeFilter: [...Object.keys(attributes), "contenteditable"],
	});
	document.addEventListener("focusin", onFocus, true);
}

function onFocus(event: FocusEvent) {
	if (event.target instanceof Element) apply(event.target);
}

function apply(node: Node) {
	if (!(node instanceof Element) || !node.isConnected) return;
	if (node.matches(selector)) suppress(node);
	for (const element of node.querySelectorAll(selector)) suppress(element);
}

function suppress(element: Element) {
	let saved = originals.get(element);
	if (!saved) {
		saved = new Map();
		originals.set(element, saved);
	}
	for (const [name, value] of Object.entries(attributes)) {
		const current = element.getAttribute(name);
		if (!saved.has(name) || current !== value) saved.set(name, current);
		if (current !== value) element.setAttribute(name, value);
	}
}

function restore(element: Element) {
	for (const [name, value] of originals.get(element) ?? []) {
		// Preserve a field's own changes made since the last observer delivery.
		if (
			element.getAttribute(name) !== attributes[name as keyof typeof attributes]
		)
			continue;
		if (value === null) element.removeAttribute(name);
		else element.setAttribute(name, value);
	}
	originals.delete(element);
}
