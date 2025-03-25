import DOMPurify from "dompurify";
import actionStack from "lib/actionStack";
import restoreTheme from "lib/restoreTheme";

/**
 * Alert dialog
 * @param {string} titleText Title text
 * @param {string} message Alert message
 * @param {function():void} [onhide] Callback function
 */
function alert(titleText, message, onhide) {
	if (!message && titleText) {
		message = titleText;
		titleText = "";
	}

	const regex = /(https?:\/\/[^\s]+)/g;
	if (regex.test(message)) {
		message = message.replace(regex, (url) => `<a href='${url}'>${url}</a>`);
	}

	const titleSpan = tag("strong", {
		className: "title",
		textContent: titleText,
	});
	const messageSpan = tag("span", {
		className: "message scroll",
		innerHTML: DOMPurify.sanitize(message),
	});
	const okBtn = tag("button", {
		textContent: strings.ok,
		onclick: hide,
	});
	const alertDiv = tag("div", {
		className: "prompt alert",
		children: [
			titleSpan,
			messageSpan,
			tag("div", {
				className: "button-container",
				child: okBtn,
			}),
		],
	});
	const mask = tag("span", {
		className: "mask",
		onclick: hide,
	});

	actionStack.push({
		id: "alert",
		action: hideAlert,
	});

	app.append(alertDiv, mask);
	restoreTheme(true);

	function hideAlert() {
		alertDiv.classList.add("hide");
		restoreTheme();
		setTimeout(() => {
			app.removeChild(alertDiv);
			app.removeChild(mask);
		}, 300);
	}

	function hide() {
		if (onhide) onhide();
		actionStack.remove("alert");
		hideAlert();
	}
}

export default alert;
