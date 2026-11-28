import autosize from "autosize";
import actionStack from "lib/actionStack";
import platform from "lib/platform";
import restoreTheme from "lib/restoreTheme";
import restorePromptInput from "./restorePromptInput";

let nextPromptId = 0;

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
 * @param {"textarea"|"text"|"filename"|"number"|"tel"|"search"|"email"|"url"} type
 * @param {PromptOptions} options
 * @returns {Promise<string|number|null>} Returns null if cancelled
 */

export default function prompt(
	message,
	defaultValue,
	type = "text",
	options = {},
) {
	const actionId = `single-prompt-${++nextPromptId}`;
	// CodeMirror doesn't use commands.exec like ACE, so we store a reference to the editor
	// to potentially disable keymaps if needed in the future
	const editor = editorManager.editor;
	const isIOSFilename = platform.isIOS && type === "filename";
	const { capitalize = !isIOSFilename } = options;

	return new Promise((resolve) => {
		const inputType = type === "textarea" ? "textarea" : "input";
		const isFilename = type === "filename";
		type = isFilename ? "text" : type;

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
		if (isIOSFilename) {
			input.setAttribute("autocorrect", "off");
			input.setAttribute("spellcheck", "false");
			input.setAttribute("writingsuggestions", "false");
		}
		const okBtn = tag("button", {
			type: "submit",
			textContent: strings.ok,
			disabled: !defaultValue,
		});
		const cancelBtn = tag("button", {
			textContent: strings.cancel,
			type: "button",
			onclick: function () {
				actionStack.remove(actionId);
				cancel();
			},
		});
		const errorMessage = tag("span", {
			className: "error-msg",
		});
		const promptDiv = tag("form", {
			action: "#",
			className: "prompt",
			onsubmit: submit,
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
			id: actionId,
			action: cancel,
			onClear: cancel,
		});

		system.setInputType("NORMAL");
		restoreTheme(true);
		app.append(promptDiv, mask);
		input.focus();
		if (input.value) {
			try {
				const col = input.value.length;
				// Select the name without its extension (or the whole name when
				// there is none), so typing replaces it
				const dot = isFilename ? input.value.lastIndexOf(".") : -1;
				if (isFilename) input.setSelectionRange(0, dot > 0 ? dot : col);
				else input.setSelectionRange(col, col);
			} catch (error) {
				// ignore
			}
		}
		if (inputType === "textarea") autosize(input);

		function submit(event) {
			event.preventDefault();
			if (okBtn.disabled || promptDiv.classList.contains("hide")) return;
			if (options.required && !input.value) {
				errorMessage.textContent = strings.required;
				return;
			}
			const value = type === "number" ? +input.value : input.value;
			hide();
			resolve(value);
		}

		function cancel() {
			resolve(null);
			hidePrompt();
		}

		function hidePrompt() {
			if (promptDiv.classList.contains("hide")) return;
			promptDiv.classList.add("hide");
			restorePromptInput();
			restoreTheme();
			setTimeout(() => {
				if (promptDiv.isConnected) promptDiv.remove();
				if (mask.isConnected) mask.remove();
			}, 300);
		}

		function hide() {
			// CodeMirror keymaps are handled differently - no need to restore commands.exec
			actionStack.remove(actionId);
			hidePrompt();
		}
	});
}
