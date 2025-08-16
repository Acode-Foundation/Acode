import autosize from "autosize";
import Checkbox from "components/checkbox";
import inputhints from "components/inputhints";
import actionStack from "lib/actionStack";
import restoreTheme from "lib/restoreTheme";
import appSettings from "lib/settings";
import alert from "./alert";

/**
 * @typedef {object} Input
 * @property {string} id Input id
 * @property {boolean} [required] Is required
 * @property {string} [type] Input type
 * @property {RegExp} [match] Input match
 * @property {string} [value] Input value
 * @property {string} [placeholder] Input placeholder
 * @property {string} [hints] Input hints
 * @property {string} [name] Input name
 * @property {boolean} [disabled] Is disabled
 * @property {function} [onclick] On click
 * @property {function} [onchange] On change
 * @property {boolean} [readOnly] Is read only
 * @property {boolean} [autofocus] Is autofocus
 * @property {boolean} [hidden] Is hidden
 */

/**
 * Opens a multi prompt dialog
 * @param {string} message Message
 * @param {Array<Input|Array<Input>>} inputs Inputs
 * @param {String} help Help text
 * @returns {Promise<Strings>}
 */
export default function multiPrompt(message, inputs, help) {
	return new Promise((resolve, reject) => {
		const $title = tag("div", {
			className: "title",
			child: tag("span", {
				textContent: message,
			}),
			style: {
				justifyContent: "space-between",
			},
		});
		const $body = tag("div", {
			className: "message scroll",
			style: {
				fontSize: "1rem",
			},
		});
		const okBtn = tag("button", {
			type: "submit",
			textContent: strings.ok,
			onclick: function (e) {
				e.preventDefault();
				e.stopPropagation();
				const inputAr = [...$body.getAll("input")];

				for (let $input of inputAr) {
					if ($input.isRequired && !$input.value) {
						$errorMessage.textContent = strings.required.capitalize();
						const $sibling = $input.nextElementSibling;
						const $parent = $input.parentElement;
						if ($sibling) $parent.insertBefore($errorMessage, $sibling);
						else $parent.append($errorMessage);
						return;
					}
				}
				hide();
				resolve(getValue());
			},
		});
		const cancelBtn = tag("button", {
			textContent: strings.cancel,
			type: "button",
			onclick: function () {
				reject();
				hide();
			},
		});
		const $errorMessage = (
			<span className="error-msg" style={{ display: "block" }} />
		);
		const $mask = <span className="mask" />;
		const $promptDiv = tag("form", {
			action: "#",
			className: "prompt multi",
			onsubmit: (e) => {
				e.preventDefault();
				if (!okBtn.disabled) {
					resolve(getValue());
				}
			},
			children: [
				$title,
				$body,
				tag("div", {
					className: "button-container",
					children: [cancelBtn, okBtn],
				}),
			],
		});

		if (/^https?:/.test(help)) {
			$title.append(
				tag("a", {
					href: help,
					className: "icon help",
				}),
			);
		} else if (typeof help === "string") {
			$title.append(
				tag("span", {
					className: "icon help",
					onclick: () => {
						alert(strings.info, help);
					},
				}),
			);
		}

		inputs.map((input) => {
			if (Array.isArray(input)) createGroup(input);
			else $body.append(createInput(input));
		});

		actionStack.push({
			id: "prompt",
			action: hidePrompt,
		});

		restoreTheme(true);
		system.setInputType("NORMAL");
		document.body.append($promptDiv, $mask);
		const $focusEl = [...$body.getAll("input[autofocus]")].pop();
		if ($focusEl) $focusEl.focus();

		function hidePrompt() {
			$promptDiv.classList.add("hide");
			restoreTheme();
			setTimeout(() => {
				if ($promptDiv.isConnected) $promptDiv.remove();
				if ($mask.isConnected) $mask.remove($mask);
			}, 300);
		}

		function hide() {
			actionStack.remove("prompt");
			system.setInputType(appSettings.value.keyboardMode);
			hidePrompt();
		}

		function getValue() {
			const values = {};
			const inputAr = [...$body.getAll("input")];
			inputAr.map(($input) => {
				if ($input.type === "checkbox" || $input.type === "radio")
					values[$input.id] = $input.checked;
				else values[$input.id] = $input.value;
			});

			return values;
		}

		/**
		 * Creates a group of inputs
		 * @param {Array<Input>} inputs Array of inputs
		 */
		function createGroup(inputs) {
			const $text = tag("span", {
				className: "hero",
			});
			const $group = tag("div", {
				className: "input-group",
				child: $text,
			});

			inputs.map((input) => {
				let $input;

				if (typeof input === "string") {
					$text.textContent = input;
				} else {
					$input = createInput(input, true);
					$group.append($input);
				}
			});

			$body.append($group);
		}

		/**
		 * Creates an input
		 * @param {Input} input Input object
		 * @param {boolean} group Whether the input is part of a group
		 * @returns {HTMLInputElement|HTMLTextAreaElement}
		 */
		function createInput(input, group = false) {
			const {
				id,
				required,
				type,
				match,
				value,
				placeholder,
				hints,
				name,
				disabled,
				onclick,
				onchange,
				readOnly,
				autofocus,
				hidden,
			} = input;

			const inputType = type === "textarea" ? "textarea" : "input";
			let _type = type === "filename" ? "text" : type || "text";

			let $input;

			if (_type === "checkbox" || _type === "radio") {
				$input = Checkbox(placeholder, value, name, id, type);

				if (!group) {
					$input.style.marginTop = "1rem";
				}
			} else {
				$input = tag(inputType, {
					id,
					placeholder,
					value: value,
					className: "input",
					isRequired: required,
					readOnly,
					autofocus,
					hidden,
				});

				if (value) {
					setTimeout(() => {
						$input.scrollLeft = $input.scrollWidth;
					}, 0);
				}

				if (disabled) $input.disabled = true;
				if (hints) inputhints($input, hints);

				if (inputType === "textarea") {
					$input.rows = 1;
					$input.inputMode = _type;
					autosize($input);
				} else {
					$input.type = _type;
				}

				$input.oninput = function () {
					if (match && !match.test(this.value)) {
						const $parent = this.parentElement;
						if ($input.nextElementSibling) {
							$parent.insertBefore($errorMessage, $input.nextElementSibling);
						} else {
							$parent.append($errorMessage);
						}
						$errorMessage.textContent = strings["invalid value"];
						okBtn.disabled = true;
					} else {
						okBtn.disabled = false;
						$errorMessage.textContent = "";
					}
				};

				$input.onfocus = function () {
					this.select();
				};
			}

			Object.defineProperty($input, "prompt", {
				value: { $body, hide },
			});

			Object.defineProperty($input, "setError", {
				value(message) {
					if (!message) {
						$errorMessage.textContent = "";
						okBtn.disabled = false;
						return;
					}

					const $parent = this.parentElement;
					if ($input.nextElementSibling) {
						$parent.insertBefore($errorMessage, $input.nextElementSibling);
					} else {
						$parent.append($errorMessage);
					}
					$errorMessage.textContent = message;
					okBtn.disabled = !!message;
				},
			});

			if (onclick) $input.onclick = onclick.bind($input);
			if (onchange) $input.onchange = onchange.bind($input);

			return $input;
		}
	});
}
