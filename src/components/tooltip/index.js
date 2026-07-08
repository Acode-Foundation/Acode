import "./style.scss";
import { animate } from "motion";

let tooltip;
let rafId = null;

function createTooltip() {
	if (tooltip) return tooltip;

	tooltip = document.createElement("div");
	tooltip.className = "acode-tooltip";
	document.body.appendChild(tooltip);

	return tooltip;
}

export function showTooltip(target, text) {
	if (!target || !text) return;

	const $tooltip = createTooltip();

	$tooltip.textContent = text;

	const rect = target.getBoundingClientRect();

	if (rafId !== null) {
		cancelAnimationFrame(rafId);
	}
	rafId = requestAnimationFrame(() => {
		const width = $tooltip.offsetWidth;
		const height = $tooltip.offsetHeight;

		const left = Math.max(
			8,
			Math.min(
				window.innerWidth - width - 8,
				rect.left + rect.width / 2 - width / 2,
			),
		);

		const top = Math.max(8, rect.top - height - 10);

		$tooltip.style.left = `${left}px`;
		$tooltip.style.top = `${top}px`;
		if (document.body.classList.contains("no-animation")) {
			$tooltip.style.opacity = "1";
			$tooltip.style.transform = "translateY(0)";
			rafId = null;
			return;
		}
		animate(
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

	if (rafId !== null) {
		cancelAnimationFrame(rafId);
		rafId = null;
	}
	if (document.body.classList.contains("no-animation")) {
		tooltip.style.opacity = "0";
		tooltip.style.transform = "translateY(5px)";
		return;
	}
	animate(
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
