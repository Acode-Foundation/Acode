import actionStack from "lib/actionStack";
import restoreTheme from "lib/restoreTheme";
import Picker from "vanilla-picker";

let lastPicked = localStorage.__picker_last_picked || "#fff";

/**
 * Choose color
 * @param {string} defaultColor Default color
 * @param {Function} [onhide] Callback function
 * @returns {Promise<string>}
 */
function color(defaultColor, onhide) {
	defaultColor = defaultColor || lastPicked;
	let type = checkColorType(defaultColor) || "hex";
	return new Promise((resolve, reject) => {
		const colorModes = ["hsl", "hex", "rgb"];
		let mode = colorModes.indexOf(type);
		let color = null;

		const parent = tag("div", {
			className: "message color-picker",
		});

		const formatToggle = tag("span", {
			className: "format-toggle",
			onclick: function (e) {
				e.preventDefault();
				e.stopPropagation();
				formatPopup.classList.toggle("visible");
			},
			children: [
				tag("span", {
					className: "format-toggle-text",
					textContent: type.toUpperCase(),
				}),
				tag("span", {
					className: "icon keyboard_arrow_down",
				}),
			],
		});

		const formatPopup = tag("div", {
			className: "format-popup",
			children: [
				tag("div", {
					className: "format-popup-backdrop",
					onclick: function () {
						formatPopup.classList.remove("visible");
					},
				}),
				tag("div", {
					className: "format-popup-body",
					children: colorModes.map((m) =>
						tag("span", {
							className: `format-option${m === type ? " active" : ""}`,
							textContent: m.toUpperCase(),
							onclick: function () {
								mode = colorModes.indexOf(m);
								type = m;
								formatToggle.get(".format-toggle-text").textContent =
									m.toUpperCase();
								formatPopup.querySelector(".active").classList.remove("active");
								this.classList.add("active");
								formatPopup.classList.remove("visible");
								picker.setOptions({
									color,
									editorFormat: type,
								});
							},
						}),
					),
				}),
			],
		});

		const okBtn = tag("button", {
			textContent: strings.ok,
			onclick: function () {
				hide();
				lastPicked = color;
				localStorage.__picker_last_picked = color;
				resolve(color);
			},
		});
		const cancelBtn = tag("button", {
			textContent: strings.cancel,
			onclick: function () {
				hide();
				reject();
			},
		});
		const box = tag("div", {
			className: "prompt box",
			children: [
				tag("div", {
					className: "title",
					children: [
						tag("span", {
							className: "title-text",
							textContent: strings["choose color"],
						}),
						formatToggle,
					],
				}),
				parent,
				tag("div", {
					className: "button-container",
					children: [cancelBtn, okBtn],
				}),
			],
		});
		const mask = tag("span", {
			className: "mask",
			onclick: function () {
				hide();
				reject();
			},
		});
		const picker = new Picker({
			parent,
			popup: false,
			editor: true,
			color: defaultColor,
			onChange,
			alpha: true,
			editorFormat: type,
		});

		picker.show();
		parent.append(formatPopup);

		actionStack.push({
			id: "box",
			action: hideSelect,
		});

		document.body.append(box, mask);

		restoreTheme(true);

		function hideSelect() {
			box.classList.add("hide");
			restoreTheme();
			setTimeout(() => {
				document.body.removeChild(box);
				document.body.removeChild(mask);
				if (typeof onhide === "function") onhide();
			}, 300);
		}

		function hide() {
			actionStack.remove("box");
			const height = box.clientHeight;
			box.style.height = height + "px";
			picker.destroy();
			hideSelect();
		}

		function onChange(c) {
			if (!c) return;

			const alpha = c.rgba[3] < 1 ? true : false;
			if (type === "hex") {
				if (alpha) color = c.hex;
				else color = c.hex.slice(0, -2);
			} else if (type === "rgb") {
				if (alpha) color = c.rgbaString;
				else color = c.rgbString;
			} else {
				if (alpha) color = c.hslaString;
				else color = c.hslString;
			}

			if (color) {
				setTimeout(() => {
					const $editor = box.get(".picker_editor");
					if ($editor) $editor.style.backgroundColor = color;
				}, 0);
			}
		}
	});
}

/**
 *
 * @param {string} color
 * @returns {'hex'|'rgb'|'hsl'}
 */
function checkColorType(color) {
	if (color.startsWith("#")) return "hex";
	if (color.startsWith("rgb")) return "rgb";
	if (color.startsWith("hsl")) return "hsl";
	return null;
}

export default color;
