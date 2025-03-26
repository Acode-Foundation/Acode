import "./style.scss";

/**@type {HTMLDivElement} */
export const sideButtonContainer = <div className="side-buttons" />;

export default function SideButtons({
	text,
	icon,
	onclick,
	backgroundColor,
	textColor,
}) {
	const $button = (
		<button
			type="button"
			className="side-button"
			onclick={onclick}
			style={{ backgroundColor, color: textColor }}
		>
			<span className={`icon ${icon}`} />
			<span>{text}</span>
		</button>
	);

	return {
		show() {
			sideButtonContainer.append($button);
		},
		hide() {
			$button.remove();
		},
	};
}
