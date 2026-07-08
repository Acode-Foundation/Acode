import "./style.scss";

let tooltip;

function createTooltip() {
	if (tooltip) return tooltip;

	tooltip = document.createElement("div");
	tooltip.className = "acode-tooltip";
	document.body.appendChild(tooltip);

	return tooltip;
}

export function showTooltip(target, text) {
	if (!target || !text) return;

	const tooltip = createTooltip();

	tooltip.textContent = text;

	const rect = target.getBoundingClientRect();

	requestAnimationFrame(() => {
		const width = tooltip.offsetWidth;
		const height = tooltip.offsetHeight;

		tooltip.style.left = rect.left + rect.width / 2 - width / 2 + "px";

		tooltip.style.top = rect.top - height - 10 + "px";

		tooltip.classList.add("show");
	});
}

export function hideTooltip() {
	if (!tooltip) return;

	tooltip.classList.remove("show");
}
