import "./style.scss";
import { animate } from "motion";
import { installIconTooltips } from "./longPress";

let tooltip;
let rafId = null;
let animation;
let icons;

export function initIconTooltips() {
	icons ||= installIconTooltips(document, showTooltip, hideTooltip);
	return icons.dismiss;
}

function createTooltip() {
	if (tooltip) return tooltip;

	tooltip = document.createElement("div");
	tooltip.className = "acode-tooltip";
	tooltip.setAttribute("role", "tooltip");
	document.body.appendChild(tooltip);

	return tooltip;
}

export function showTooltip(target, text, description) {
	if (!target || !text) return;

	const $tooltip = createTooltip();

	animation?.stop();
	$tooltip.replaceChildren();
	const label = document.createElement("div");
	label.textContent = text;
	$tooltip.append(label);
	if (description) {
		const detail = document.createElement("div");
		detail.className = "acode-tooltip-description";
		detail.textContent = description;
		$tooltip.append(detail);
	}
	$tooltip.removeAttribute("aria-hidden");

	const rect = target.getBoundingClientRect();

	if (rafId !== null) {
		cancelAnimationFrame(rafId);
	}
	rafId = requestAnimationFrame(() => {
		const viewport = window.visualViewport;
		const x = viewport?.offsetLeft || 0,
			y = viewport?.offsetTop || 0;
		const visibleWidth = viewport?.width || window.innerWidth;
		const visibleHeight = viewport?.height || window.innerHeight;
		$tooltip.style.maxWidth = `${Math.max(0, visibleWidth - 16)}px`;
		$tooltip.style.maxHeight = `${Math.max(0, visibleHeight - 16)}px`;
		const width = $tooltip.offsetWidth;
		const height = $tooltip.offsetHeight;

		const left = Math.max(
			x + 8,
			Math.min(
				x + visibleWidth - width - 8,
				rect.left + rect.width / 2 - width / 2,
			),
		);

		const above = rect.top - height - 10;
		const top = Math.max(
			y + 8,
			Math.min(
				y + visibleHeight - height - 8,
				above >= y + 8 ? above : rect.bottom + 10,
			),
		);

		$tooltip.style.left = `${left}px`;
		$tooltip.style.top = `${top}px`;
		if (document.body.classList.contains("no-animation")) {
			$tooltip.style.opacity = "1";
			$tooltip.style.transform = "translateY(0)";
			rafId = null;
			return;
		}
		animation = animate(
			$tooltip,
			{
				opacity: 1,
				transform: "translateY(0px)",
			},
			{
				duration: 0.15,
			},
		);
		rafId = null;
	});
}

export function hideTooltip() {
	if (!tooltip) return;
	animation?.stop();
	tooltip.setAttribute("aria-hidden", "true");

	if (rafId !== null) {
		cancelAnimationFrame(rafId);
		rafId = null;
	}
	if (document.body.classList.contains("no-animation")) {
		tooltip.style.opacity = "0";
		tooltip.style.transform = "translateY(5px)";
		return;
	}
	animation = animate(
		tooltip,
		{
			opacity: 0,
			transform: "translateY(5px)",
		},
		{
			duration: 0.15,
		},
	);
}
