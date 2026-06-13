import Checkbox from "components/checkbox";
import DOMPurify from "dompurify";
import actionStack from "lib/actionStack";
import restoreTheme from "lib/restoreTheme";

/**
 * Confirm dialog box
 * @param {string} titleText Title text
 * @param {string} [message] Alert message
 * @param {boolean} [isHTML] Whether the message is HTML
 * @param {{checkboxText?: string, returnState?: boolean}} [options]
 * @returns {Promise<boolean | {confirmed: boolean, checked: boolean}>}
 */
function confirm(titleText, message, isHTML, options = {}) {
	return new Promise((resolve) => {
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
			onclick: function () {
				hide();
				resolve(getResponse(true));
			},
		});
		const cancelBtn = tag("button", {
			textContent: strings.cancel,
			onclick: function () {
				hide();
				resolve(getResponse(false));
			},
		});
		const confirmDiv = tag("div", {
			className: "prompt confirm",
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
			id: "confirm",
			action: hideAlert,
		});

		app.append(confirmDiv, mask);
		restoreTheme(true);

		function hideAlert() {
			confirmDiv.classList.add("hide");
			restoreTheme();
			setTimeout(() => {
				app.removeChild(confirmDiv);
				app.removeChild(mask);
			}, 300);
		}

		function hide() {
			actionStack.remove("confirm");
			hideAlert();
		}
	});
}

export default confirm;
