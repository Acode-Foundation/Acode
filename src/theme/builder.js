import Color from "utils/color";

export default class ThemeBuilder {
	#theme = {
		"--popup-border-radius": "4px",
		"--active-color": "rgb(51, 153, 255)",
		"--active-text-color": "rgb(255, 215, 0)",
		"--active-icon-color": "rgba(0, 0, 0, 0.2)",
		"--border-color": "rgba(122, 122, 122, 0.2)",
		"--box-shadow-color": "rgba(0, 0, 0, 0.2)",
		"--button-active-color": "rgb(44, 142, 240)",
		"--button-background-color": "rgb(51, 153, 255)",
		"--button-text-color": "rgb(255, 255, 255)",
		"--error-text-color": "rgb(255, 185, 92)",
		"--primary-color": "rgb(153, 153, 255)",
		"--primary-text-color": "rgb(255, 255, 255)",
		"--secondary-color": "rgb(255, 255, 255)",
		"--secondary-text-color": "rgb(37, 37, 37)",
		"--link-text-color": "rgb(97, 94, 253)",
		"--scrollbar-color": "rgba(0, 0, 0, 0.3)",
		"--popup-border-color": "rgba(0, 0, 0, 0)",
		"--popup-icon-color": "rgb(153, 153, 255)",
		"--popup-background-color": "rgb(255, 255, 255)",
		"--popup-text-color": "rgb(37, 37, 37)",
		"--popup-active-color": "rgb(169, 0, 0)",
		"--danger-color": "rgb(160, 51, 0)",
		"--danger-text-color": "rgb(255, 255, 255)",
		"--file-tab-width": "120px",
	};

	version = "free";
	name = "Default";
	type = "light";
	/** Whether Auto update darkened primary color when primary color is updated. */
	autoDarkened = true;
	preferredEditorTheme = null;
	preferredFont = null;

	/**
	 * Creates a theme
	 * @param {string} [name] name of the theme
	 * @param {'dark'|'light'} [type] type of the theme
	 * @param {'free'|'paid'} [version]  version of the theme
	 */
	constructor(name = "", type = "dark", version = "free") {
		this.name = name;
		this.type = type;
		this.version = version;
	}

	get id() {
		return this.name.toLowerCase();
	}

	get popupBorderRadius() {
		return this.#theme["--popup-border-radius"];
	}

	set popupBorderRadius(value) {
		this.#theme["--popup-border-radius"] = value;
	}

	get activeColor() {
		return this.#theme["--active-color"];
	}

	set activeColor(value) {
		this.#theme["--active-color"] = value;
	}

	get activeIconColor() {
		return this.#theme["--active-icon-color"];
	}

	set activeIconColor(value) {
		this.#theme["--active-icon-color"] = value;
	}

	get borderColor() {
		return this.#theme["--border-color"];
	}

	set borderColor(value) {
		this.#theme["--border-color"] = value;
	}

	get boxShadowColor() {
		return this.#theme["--box-shadow-color"];
	}

	set boxShadowColor(value) {
		this.#theme["--box-shadow-color"] = value;
	}

	get buttonActiveColor() {
		return this.#theme["--button-active-color"];
	}

	set buttonActiveColor(value) {
		this.#theme["--button-active-color"] = value;
	}

	get buttonBackgroundColor() {
		return this.#theme["--button-background-color"];
	}

	set buttonBackgroundColor(value) {
		this.#theme["--button-background-color"] = value;
	}

	get buttonTextColor() {
		return this.#theme["--button-text-color"];
	}

	set buttonTextColor(value) {
		this.#theme["--button-text-color"] = value;
	}

	get errorTextColor() {
		return this.#theme["--error-text-color"];
	}

	set errorTextColor(value) {
		this.#theme["--error-text-color"] = value;
	}

	get primaryColor() {
		return this.#theme["--primary-color"];
	}

	set primaryColor(value) {
		if (this.autoDarkened) {
			this.darkenedPrimaryColor = Color(value).darken(0.4).hex.toString();
		}
		this.#theme["--primary-color"] = value;
	}

	get primaryTextColor() {
		return this.#theme["--primary-text-color"];
	}

	set primaryTextColor(value) {
		this.#theme["--primary-text-color"] = value;
	}

	get secondaryColor() {
		return this.#theme["--secondary-color"];
	}

	set secondaryColor(value) {
		this.#theme["--secondary-color"] = value;
	}

	get secondaryTextColor() {
		return this.#theme["--secondary-text-color"];
	}

	set secondaryTextColor(value) {
		this.#theme["--secondary-text-color"] = value;
	}

	get linkTextColor() {
		return this.#theme["--link-text-color"];
	}

	set linkTextColor(value) {
		this.#theme["--link-text-color"] = value;
	}

	get scrollbarColor() {
		return this.#theme["--scrollbar-color"];
	}

	set scrollbarColor(value) {
		this.#theme["--scrollbar-color"] = value;
	}

	get popupBorderColor() {
		return this.#theme["--popup-border-color"];
	}

	set popupBorderColor(value) {
		this.#theme["--popup-border-color"] = value;
	}

	get popupIconColor() {
		return this.#theme["--popup-icon-color"];
	}

	set popupIconColor(value) {
		this.#theme["--popup-icon-color"] = value;
	}

	get popupBackgroundColor() {
		return this.#theme["--popup-background-color"];
	}

	set popupBackgroundColor(value) {
		this.#theme["--popup-background-color"] = value;
	}

	get popupTextColor() {
		return this.#theme["--popup-text-color"];
	}

	set popupTextColor(value) {
		this.#theme["--popup-text-color"] = value;
	}

	get popupActiveColor() {
		return this.#theme["--popup-active-color"];
	}

	set popupActiveColor(value) {
		this.#theme["--popup-active-color"] = value;
	}

	get dangerColor() {
		return this.#theme["--danger-color"];
	}

	set dangerColor(value) {
		this.#theme["--danger-color"] = value;
	}

	get fileTabWidth() {
		return this.#theme["--file-tab-width"];
	}

	set fileTabWidth(value) {
		this.#theme["--file-tab-width"] = value;
	}

	get activeTextColor() {
		return this.#theme["--active-text-color"];
	}

	set activeTextColor(value) {
		this.#theme["--active-text-color"] = value;
	}

	get css() {
		let css = "";
		Object.keys(this.#theme).forEach((key) => {
			css += `${key}: ${this.#theme[key]};`;
		});
		return `:root {${css}}`;
	}

	/**
	 * Gets the theme as an object
	 * @param {'rgba'|'hex' | 'none'} colorType
	 * @returns {Object<string, string>}
	 */
	toJSON(colorType = "none") {
		const res = {
			name: this.name,
			type: this.type,
			version: this.version,
		};
		Object.keys(this.#theme).forEach((key) => {
			const color =
				colorType === "hex"
					? Color(this.#theme[key]).hex.toString()
					: colorType === "rgba"
						? Color(this.#theme[key]).rgba.toString()
						: this.#theme[key];
			res[ThemeBuilder.#toPascal(key)] = color;
		});
		return res;
	}

	toString() {
		return JSON.stringify(this.toJSON());
	}

	/**
	 * This method is used to set a darkened primary color.
	 */
	darkenPrimaryColor() {
		this.darkenedPrimaryColor = Color(this.primaryColor)
			.darken(0.4)
			.hex.toString();
	}

	matches(id) {
		return this.id.toLowerCase() === id.toLowerCase();
	}

	/**
	 * Creates a theme from a CSS string
	 * @param {string} name
	 * @param {string} css
	 * @returns {ThemeBuilder}
	 */
	static fromCSS(name, css) {
		const themeBuilder = new ThemeBuilder(name);

		// get rules using regex
		const rules = css.match(/:root\s*{([^}]*)}/);
		if (!rules) throw new Error("Invalid CSS string");

		// get variables using regex
		const variables = rules[1].match(/--[\w-]+:\s*[^;]+/g);
		if (!variables) throw new Error("Invalid CSS string");

		// set variables
		variables.forEach((variable) => {
			const [key, value] = variable.split(":");
			themeBuilder(ThemeBuilder.#toPascal(key.trim()), value.trim());
		});

		return themeBuilder;
	}

	static fromJSON(theme) {
		if (!theme) throw new Error("Theme is required");
		if (typeof theme !== "object") throw new Error("Theme must be an object");
		if (!theme.name) throw new Error("Theme name is required");
		if (!theme.type) throw new Error("Theme type is required");
		if (!theme.version) throw new Error("Theme version is required");
		const themeBuilder = new ThemeBuilder(
			theme.name,
			theme.type,
			theme.version,
		);

		Object.keys(theme).forEach((key) => {
			if (!Object.getOwnPropertyDescriptor(ThemeBuilder.prototype, key)) return;
			themeBuilder[key] = theme[key];
		});

		return themeBuilder;
	}

	/**
	 *
	 * @param {string} str
	 */
	static #toPascal(str) {
		// e.g. '--primary-color' => 'PrimaryColor'
		return str
			.replace(/^--/, "")
			.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
	}
}

export function createBuiltInTheme(name, type, version = "paid") {
	const theme = new ThemeBuilder(name, type, version);
	theme.autoDarkened = false;
	return theme;
}
