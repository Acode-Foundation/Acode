import Checkbox from "components/checkbox";
import DOMPurify from "dompurify";
import actionStack from "lib/actionStack";
import restoreTheme from "lib/restoreTheme";

let nextConfirmId = 0;

/**
 * Confirm dialog box
 * @param {string} titleText Title text
 * @param {string} [message] Alert message
 * @param {boolean} [isHTML] Whether the message is HTML
 * @param {{checkboxText?: string, returnState?: boolean, signal?: AbortSignal, direction?: "ltr" | "rtl", aboveOverlay?: boolean}} [options]
 * @returns {Promise<boolean | {confirmed: boolean, checked: boolean}>}
 */
function confirm(titleText, message, isHTML, options = {}) {
	return new Promise((resolve) => {
		if (options.signal?.aborted) {
			resolve(
				options.returnState ? { confirmed: false, checked: false } : false,
			);
			return;
		}
		const actionId = `confirm-${++nextConfirmId}`;
		let closed = false;
		if (!message && titleText) {
			message = titleText;
			titleText = "";
		}

		const titleSpan = tag("strong", {
			className: "title",
			textContent: titleText,
		});
		const messageSpan = tag("span", {
			className: "message scroll",
			innerHTML: isHTML ? DOMPurify.sanitize(message) : undefined,
			textContent: isHTML ? undefined : message,
		});
		const checkbox = options.checkboxText
			? Checkbox(options.checkboxText, false)
			: null;
		if (checkbox) {
			checkbox.classList.add("confirm-checkbox");
		}
		const getResponse = (confirmed) => {
			if (!options.returnState) return confirmed;
			return {
				confirmed,
				checked: Boolean(checkbox?.checked),
			};
		};
		const okBtn = tag("button", {
			textContent: strings.ok,
			onclick: () => close(true),
		});
		const cancelBtn = tag("button", {
			textContent: strings.cancel,
			onclick: cancel,
		});
		const confirmDiv = tag("div", {
			className: `prompt confirm${options.aboveOverlay ? " above-overlay" : ""}`,
			dir: options.direction,
			children: [
				titleSpan,
				messageSpan,
				checkbox,
				tag("div", {
					className: "button-container",
					children: [cancelBtn, okBtn],
				}),
			].filter(Boolean),
		});
		const mask = tag("span", {
			className: "mask",
		});

		actionStack.push({
			id: actionId,
			action: cancel,
		});

		app.append(confirmDiv, mask);
		restoreTheme(true);
		options.signal?.addEventListener("abort", cancel, { once: true });

		function cancel() {
			close(false);
		}

		function close(confirmed) {
			if (closed) return;
			closed = true;
			options.signal?.removeEventListener("abort", cancel);
			hide();
			resolve(getResponse(confirmed));
		}

		function hideAlert() {
			confirmDiv.classList.add("hide");
			restoreTheme();
			setTimeout(() => {
				confirmDiv.remove();
				mask.remove();
			}, 300);
		}

		function hide() {
			actionStack.remove(actionId);
			hideAlert();
		}
	});
}

export default confirm;
