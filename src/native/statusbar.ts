import exec from "./exec";

let visible = true;
let colorProbe: HTMLSpanElement | undefined;

export default {
	get visible() {
		return visible;
	},
	set visible(value: boolean) {
		visible = value;
		exec(null, null, "SystemBarPlugin", "setStatusBarVisible", [value]);
	},
	setBackgroundColor(value: string) {
		if (!colorProbe) {
			colorProbe = document.createElement("span");
			colorProbe.hidden = true;
			document.head.appendChild(colorProbe);
		}
		colorProbe.style.color = value;
		const color = getComputedStyle(colorProbe).getPropertyValue("color");
		if (!color.startsWith("rgb")) return;
		const components = color
			.match(/[\d.]+/g)
			?.map((part, index) =>
				index < 3 ? Number.parseInt(part, 10) : Number.parseFloat(part),
			);
		if (components && components.length >= 3)
			exec(
				null,
				null,
				"SystemBarPlugin",
				"setStatusBarBackgroundColor",
				components,
			);
	},
};
