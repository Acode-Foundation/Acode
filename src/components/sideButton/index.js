import { animate, press } from "motion";
import "./style.scss";

/**@type {HTMLDivElement} */
export const sideButtonContainer = <div className="side-buttons"></div>;

export default function SideButtons({
	text,
	icon,
	onclick,
	backgroundColor,
	textColor,
}) {
	const $button = (
		<button
			className="side-button"
			onclick={onclick}
			style={{ backgroundColor, color: textColor }}
		>
			<spam className={`icon ${icon}`}></spam>
			<span>{text}</span>
		</button>
	);

	press($button, (element) => {
		if (document.body.classList.contains("no-animation")) return;
		animate(
			element,
			{ scale: 0.95 },
			{ type: "spring", stiffness: 450, damping: 20 },
		);
		return () => {
			animate(
				element,
				{ scale: 1 },
				{ type: "spring", stiffness: 450, damping: 20 },
			);
		};
	});

	return {
		show() {
			sideButtonContainer.append($button);
		},
		hide() {
			$button.remove();
		},
	};
}
