const marker = "data-acode-fullscreen";
const layout = {
	position: "fixed",
	top: "0px",
	right: "0px",
	bottom: "0px",
	left: "0px",
	width: "100%",
	height: "100%",
	"min-width": "0px",
	"min-height": "0px",
	"max-width": "none",
	"max-height": "none",
	"box-sizing": "border-box",
	transform: "none",
	...Object.fromEntries(
		["top", "right", "bottom", "left"].flatMap((side) => [
			[`margin-${side}`, "0px"],
			[`padding-${side}`, "0px"],
			[`border-${side}-width`, "0px"],
		]),
	),
};

export default function fullscreenLayout(target: HTMLElement) {
	const saved = new Map<string, { value: string; priority: string }>();
	const markers = new Map<Element, string | null>();
	let ancestor: Element = target;
	while (true) {
		markers.set(ancestor, ancestor.getAttribute(marker));
		ancestor.setAttribute(marker, "");
		const root = ancestor.getRootNode();
		if (!(root instanceof ShadowRoot)) break;
		ancestor = root.host;
	}
	const observer = new MutationObserver(apply);
	apply();
	observer.observe(target, { attributes: true, attributeFilter: ["style"] });
	return () => {
		observer.disconnect();
		for (const [property, previous] of saved) {
			if (
				target.style.getPropertyValue(property) !==
					layout[property as keyof typeof layout] ||
				target.style.getPropertyPriority(property) !== "important"
			)
				continue;
			if (previous.value)
				target.style.setProperty(property, previous.value, previous.priority);
			else target.style.removeProperty(property);
		}
		for (const [element, value] of markers) {
			if (value === null) element.removeAttribute(marker);
			else element.setAttribute(marker, value);
		}
	};

	function apply() {
		for (const [property, value] of Object.entries(layout)) {
			const current = target.style.getPropertyValue(property);
			const priority = target.style.getPropertyPriority(property);
			if (saved.has(property) && current === value && priority === "important")
				continue;
			saved.set(property, { value: current, priority });
			target.style.setProperty(property, value, "important");
		}
	}
}
