import "./style.scss";

/**@type {Array<HTMLElement>} */
const toastQueue = [];

/**
 * Show a toast message
 * @param {string|HTMLElement} message
 * @param {number|false} duration
 */
export default function toast(message, duration = 0, bgColor, color) {
	const $oldToast = tag.get("#toast");
	const $toast = (
		<div
			id="toast"
			attr-clickable={typeof duration !== "number"}
			style={{ backgroundColor: bgColor, color }}
		>
			<span className="message">{message}</span>
			{duration === false
				? <button
						className="icon clearclose"
						onclick={() => $toast.hide()}
					></button>
				: ""}
		</div>
	);

	Object.defineProperties($toast, {
		hide: {
			value() {
				this.classList.add("hide");
				setTimeout(() => {
					this.remove();
					const $toast = toastQueue.splice(0, 1)[0];
					if ($toast) $toast.show();
				}, 500);
			},
		},
		show: {
			value() {
				app.append(this);

				if (typeof duration === "number") {
					setTimeout(() => {
						this.hide();
					}, duration || 3000);
				}
			},
		},
	});

	if (!$oldToast) {
		$toast.show();
	} else {
		toastQueue.push($toast);
	}
}

toast.hide = () => {
	const $toast = tag.get("#toast");
	if ($toast) $toast.hide();
};
