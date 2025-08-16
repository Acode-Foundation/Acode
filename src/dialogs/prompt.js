import autosize from "autosize";
import actionStack from "lib/actionStack";
import restoreTheme from "lib/restoreTheme";
import appSettings from "lib/settings";

/**
 * @typedef {Object} PromptOptions
 * @property {RegExp} [match]
 * @property {boolean} [required]
 * @property {string} [placeholder]
 * @property {boolean} [capitalize] - If true, the first letter of the input will be capitalized
 * @property {(any)=>boolean} [test]
 */

/**
 * Opens a prompt dialog
 * @param {string} message
 * @param {string} defaultValue
 * @param {"textarea"|"text"|"number"|"tel"|"search"|"email"|"url"} type
 * @param {PromptOptions} options
 * @returns {Promise<string|number|null>} Returns null if cancelled
 */

export default function prompt(
	message,
	defaultValue,
	type = "text",
	options = {},
) {
	const commands = editorManager.editor.commands;
	const originalExec = commands.exec;
	const { capitalize = true } = options;

	commands.exec = () => {}; // Disable all shortcuts

	return new Promise((resolve) => {
		const inputType = type === "textarea" ? "textarea" : "input";
		type = type === "filename" ? "text" : type;

		const messageSpan = tag("span", {
			textContent: message,
			className: "message scroll",
		});
		const input = tag(inputType, {
			value: defaultValue,
			className: "input",
			placeholder: options.placeholder,
			autocapitalize: capitalize ? "on" : "off",
		});
		const okBtn = tag("button", {
			type: "submit",
			textContent: strings.ok,
			disabled: !defaultValue,
			onclick: function () {
				if (options.required && !input.value) {
					errorMessage.textContent = strings.required;
					return;
				}
				hide();
				let { value } = input;
				if (type === "number") value = +value;

				resolve(value);
			},
		});
		const cancelBtn = tag("button", {
			textContent: strings.cancel,
			type: "button",
			onclick: function () {
				hide();
				resolve(null);
			},
		});
		const errorMessage = tag("span", {
			className: "error-msg",
		});
		const promptDiv = tag("form", {
			action: "#",
			className: "prompt",
			onsubmit: (e) => {
				e.preventDefault();
				if (!okBtn.disabled) {
					resolve(input.value);
				}
			},
			children: [
				messageSpan,
				input,
				errorMessage,
				tag("div", {
					className: "button-container",
					children: [cancelBtn, okBtn],
				}),
			],
		});
		const mask = tag("span", {
			className: "mask",
		});

		if (inputType === "textarea") {
			input.rows = 1;
			input.inputMode = type;
		} else {
			input.type = type;
			if (type === "number") {
				input.step = "any";
			}
		}

		input.oninput = function () {
			const { match, test } = options;
			let isValid = true;

			if (match) {
				isValid = match.test(input.value);
			}

			if (test) {
				isValid = test(input.value);
			}

			if (!isValid) {
				okBtn.disabled = true;
				errorMessage.textContent = strings["invalid value"];
			} else {
				okBtn.disabled = false;
				errorMessage.textContent = "";
			}
		};

		input.onfocus = function () {
			this.select();
		};

		actionStack.push({
			id: "prompt",
			action: hidePrompt,
		});

		system.setInputType("NORMAL");
		restoreTheme(true);
		app.append(promptDiv, mask);
		input.focus();
		if (input.value) {
			try {
				const col = input.value.length;
				input.setSelectionRange(col, col);
			} catch (error) {
				// ignore
			}
		}
		if (inputType === "textarea") autosize(input);

		function hidePrompt() {
			promptDiv.classList.add("hide");
			restoreTheme();
			setTimeout(() => {
				if (promptDiv.isConnected) promptDiv.remove();
				if (mask.isConnected) mask.remove();
			}, 300);
		}

		function hide() {
			commands.exec = originalExec;
			actionStack.remove("prompt");
			system.setInputType(appSettings.value.keyboardMode);
			hidePrompt();
		}
	});
}
