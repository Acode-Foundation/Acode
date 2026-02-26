export const MAX_16_BASE = "(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)";
export const HUE_VALUE =
	"(360(\\.0+)?|(3[0-5][0-9]|([0-9]|[1-9][0-9]|1[0-9][0-9]|2[0-9][0-9])(\\.\\d+)?)|(\\.\\d+))";
export const MAX_PERCENTAGE = "((100(\\.0+)?|[1-9]?[0-9](\\.\\d+)?|\\.\\d+)%)";
export const MAX_ALPHA = `((0(\\.\\d+)?|1(\\.0+)?|\\.\\d+)|${MAX_PERCENTAGE})`;
export const RGB_VALUE = `(\\s*${MAX_16_BASE}|${MAX_PERCENTAGE}\\s*)`;
export const RGB_VALUES = `${RGB_VALUE},${RGB_VALUE},${RGB_VALUE}`;
export const RGB_VALUES_NO_COMMA = `${RGB_VALUE}{3}`;
export const RGB = `(rgb\\s*\\(${RGB_VALUES}\\)|rgb\\s*\\(${RGB_VALUES_NO_COMMA}\\))`;
export const RGBA = `(rgba\\s*\\(${RGB_VALUES}\\s*,\\s*${MAX_ALPHA}\\s*\\)|rgba\\s*\\(${RGB_VALUES_NO_COMMA}\\s+${MAX_ALPHA}\\s*\\))`;
export const HSL_VALUE = `\\s*${HUE_VALUE}\\s*,\\s*${MAX_PERCENTAGE}\\s*,\\s*${MAX_PERCENTAGE}\\s*`;
export const HSL_VALUE_NO_COMMA = `\\s*${HUE_VALUE}\\s+${MAX_PERCENTAGE}\\s+${MAX_PERCENTAGE}\\s*`;
export const HSL = `(hsl\\s*\\(${HSL_VALUE}\\)|hsl\\s*\\(${HSL_VALUE_NO_COMMA}\\))`;
export const HSLA = `(hsla\\s*\\(${HSL_VALUE}\\s*,\\s*${MAX_ALPHA}\\s*\\)|hsla\\s*\\(${HSL_VALUE_NO_COMMA}\\s+\/\/\\s+${MAX_ALPHA}\\s*\\)|hsla\\s*\\(${HSL_VALUE_NO_COMMA}\\s+${MAX_ALPHA}\\s*\\))`;
export const HEX = "(#[0-9a-f]{3,8})";
export const NAMED_COLORS = {
	black: "rgb(0, 0, 0)",
	silver: "rgb(192, 192, 192)",
	gray: "rgb(128, 128, 128)",
	white: "rgb(255, 255, 255)",
	maroon: "rgb(128, 0, 0)",
	red: "rgb(255, 0, 0)",
	purple: "rgb(128, 0, 128)",
	fuchsia: "rgb(255, 0, 255)",
	green: "rgb(0, 128, 0)",
	lime: "rgb(0, 255, 0)",
	olive: "rgb(128, 128, 0)",
	yellow: "rgb(255, 255, 0)",
	navy: "rgb(0, 0, 128)",
	blue: "rgb(0, 0, 255)",
	teal: "rgb(0, 128, 128)",
	aqua: "rgb(0, 255, 255)",
	aliceblue: "rgb(240, 248, 255)",
	antiquewhite: "rgb(250, 235, 215)",
	aquamarine: "rgb(127, 255, 212)",
	azure: "rgb(240, 255, 255)",
	beige: "rgb(245, 245, 220)",
	bisque: "rgb(255, 228, 196)",
	blanchedalmond: "rgb(255, 235, 205)",
	blueviolet: "rgb(138, 43, 226)",
	brown: "rgb(165, 42, 42)",
	burlywood: "rgb(222, 184, 135)",
	cadetblue: "rgb(95, 158, 160)",
	chartreuse: "rgb(127, 255, 0)",
	chocolate: "rgb(210, 105, 30)",
	coral: "rgb(255, 127, 80)",
	cornflowerblue: "rgb(100, 149, 237)",
	cornsilk: "rgb(255, 248, 220)",
	crimson: "rgb(220, 20, 60)",
	cyan: "rgb(0, 255, 255)",
	darkblue: "rgb(0, 0, 139)",
	darkcyan: "rgb(0, 139, 139)",
	darkgoldenrod: "rgb(184, 134, 11)",
	darkgray: "rgb(169, 169, 169)",
	darkgreen: "rgb(0, 100, 0)",
	darkgrey: "rgb(169, 169, 169)",
	darkkhaki: "rgb(189, 183, 107)",
	darkmagenta: "rgb(139, 0, 139)",
	darkolivegreen: "rgb(85, 107, 47)",
	darkorange: "rgb(255, 140, 0)",
	darkorchid: "rgb(153, 50, 204)",
	darkred: "rgb(139, 0, 0)",
	darksalmon: "rgb(233, 150, 122)",
	darkseagreen: "rgb(143, 188, 143)",
	darkslateblue: "rgb(72, 61, 139)",
	darkslategray: "rgb(47, 79, 79)",
	darkslategrey: "rgb(47, 79, 79)",
	darkturquoise: "rgb(0, 206, 209)",
	darkviolet: "rgb(148, 0, 211)",
	deeppink: "rgb(255, 20, 147)",
	deepskyblue: "rgb(0, 191, 255)",
	dimgray: "rgb(105, 105, 105)",
	dimgrey: "rgb(105, 105, 105)",
	dodgerblue: "rgb(30, 144, 255)",
	firebrick: "rgb(178, 34, 34)",
	floralwhite: "rgb(255, 250, 240)",
	forestgreen: "rgb(34, 139, 34)",
	gainsboro: "rgb(220, 220, 220)",
	ghostwhite: "rgb(248, 248, 255)",
	gold: "rgb(255, 215, 0)",
	goldenrod: "rgb(218, 165, 32)",
	greenyellow: "rgb(173, 255, 47)",
	grey: "rgb(128, 128, 128)",
	honeydew: "rgb(240, 255, 240)",
	hotpink: "rgb(255, 105, 180)",
	indianred: "rgb(205, 92, 92)",
	indigo: "rgb(75, 0, 130)",
	ivory: "rgb(255, 255, 240)",
	khaki: "rgb(240, 230, 140)",
	lavender: "rgb(230, 230, 250)",
	lavenderblush: "rgb(255, 240, 245)",
	lawngreen: "rgb(124, 252, 0)",
	lemonchiffon: "rgb(255, 250, 205)",
	lightblue: "rgb(173, 216, 230)",
	lightcoral: "rgb(240, 128, 128)",
	lightcyan: "rgb(224, 255, 255)",
	lightgoldenrodyellow: "rgb(250, 250, 210)",
	lightgray: "rgb(211, 211, 211)",
	lightgreen: "rgb(144, 238, 144)",
	lightgrey: "rgb(211, 211, 211)",
	lightpink: "rgb(255, 182, 193)",
	lightsalmon: "rgb(255, 160, 122)",
	lightseagreen: "rgb(32, 178, 170)",
	lightskyblue: "rgb(135, 206, 250)",
	lightslategray: "rgb(119, 136, 153)",
	lightslategrey: "rgb(119, 136, 153)",
	lightsteelblue: "rgb(176, 196, 222)",
	lightyellow: "rgb(255, 255, 224)",
	limegreen: "rgb(50, 205, 50)",
	linen: "rgb(250, 240, 230)",
	magenta: "rgb(255, 0, 255)",
	mediumaquamarine: "rgb(102, 205, 170)",
	mediumblue: "rgb(0, 0, 205)",
	mediumorchid: "rgb(186, 85, 211)",
	mediumpurple: "rgb(147, 112, 219)",
	mediumseagreen: "rgb(60, 179, 113)",
	mediumslateblue: "rgb(123, 104, 238)",
	mediumspringgreen: "rgb(0, 250, 154)",
	mediumturquoise: "rgb(72, 209, 204)",
	mediumvioletred: "rgb(199, 21, 133)",
	midnightblue: "rgb(25, 25, 112)",
	mintcream: "rgb(245, 255, 250)",
	mistyrose: "rgb(255, 228, 225)",
	moccasin: "rgb(255, 228, 181)",
	navajowhite: "rgb(255, 222, 173)",
	oldlace: "rgb(253, 245, 230)",
	olivedrab: "rgb(107, 142, 35)",
	orangered: "rgb(255, 69, 0)",
	orchid: "rgb(218, 112, 214)",
	palegoldenrod: "rgb(238, 232, 170)",
	palegreen: "rgb(152, 251, 152)",
	paleturquoise: "rgb(175, 238, 238)",
	palevioletred: "rgb(219, 112, 147)",
	papayawhip: "rgb(255, 239, 213)",
	peachpuff: "rgb(255, 218, 185)",
	peru: "rgb(205, 133, 63)",
	pink: "rgb(255, 192, 203)",
	plum: "rgb(221, 160, 221)",
	powderblue: "rgb(176, 224, 230)",
	rebeccapurple: "rgb(102, 51, 153)",
	rosybrown: "rgb(188, 143, 143)",
	royalblue: "rgb(65, 105, 225)",
	saddlebrown: "rgb(139, 69, 19)",
	salmon: "rgb(250, 128, 114)",
	sandybrown: "rgb(244, 164, 96)",
	seagreen: "rgb(46, 139, 87)",
	seashell: "rgb(255, 245, 238)",
	sienna: "rgb(160, 82, 45)",
	skyblue: "rgb(135, 206, 235)",
	slateblue: "rgb(106, 90, 205)",
	slategray: "rgb(112, 128, 144)",
	slategrey: "rgb(112, 128, 144)",
	snow: "rgb(255, 250, 250)",
	springgreen: "rgb(0, 255, 127)",
	steelblue: "rgb(70, 130, 180)",
	tan: "rgb(210, 180, 140)",
	thistle: "rgb(216, 191, 216)",
	tomato: "rgb(255, 99, 71)",
	turquoise: "rgb(64, 224, 208)",
	violet: "rgb(238, 130, 238)",
	wheat: "rgb(245, 222, 179)",
	whitesmoke: "rgb(245, 245, 245)",
	yellowgreen: "rgb(154, 205, 50)",
};

const namedColors = Object.keys(NAMED_COLORS).join("|");

export const colorRegex = {
	/**
	 * Regular expression to match rgb colors
	 * @type {RegExp}
	 */
	get rgb() {
		delete this.rgb;
		this.rgb = new RegExp(`^${RGB}$`);
		return this.rgb;
	},
	/**
	 * Regular expression to match rgba colors
	 * @type {RegExp}
	 */
	get rgba() {
		delete this.rgba;
		this.rgba = new RegExp(`^${RGBA}$`);
		return this.rgba;
	},
	/**
	 * Regular expression to match hsl colors
	 * @type {RegExp}
	 */
	get hsl() {
		delete this.hsl;
		this.hsl = new RegExp(`^${HSL}$`);
		return this.hsl;
	},
	/**
	 * Regular expression to match hsla colors
	 * @type {RegExp}
	 */
	get hsla() {
		delete this.hsla;
		this.hsla = new RegExp(`^${HSLA}$`);
		return this.hsla;
	},
	/**
	 * Regular expression to match hex colors
	 * @type {RegExp}
	 */
	get hex() {
		delete this.hex;
		this.hex = new RegExp(`^${HEX}$`);
		return this.hex;
	},
	/**
	 * Regular expression to match any color
	 * @type {RegExp}
	 */
	get named() {
		delete this.named;
		this.named = new RegExp(`^(${namedColors})$`);
		return this.named;
	},
	/**
	 * Regular expression to match any color
	 * @type {RegExp}
	 */
	get anyStrict() {
		delete this.any;
		this.any = new RegExp(
			`^(${namedColors}|${RGB}|${RGBA}|${HSL}|${HSLA}|${HEX})$`,
			"i",
		);
		return this.any;
	},
	/**
	 * Regular expression to match any color
	 * Always return a new RegExp instance
	 * @type {RegExp}
	 */
	get anyGlobal() {
		// Negative lookbehind is not supported in older browsers
		return new RegExp(
			`(^|\\W)(${namedColors}|${RGB}|${RGBA}|${HSL}|${HSLA}|${HEX})($|\\W)`,
			"gi",
		);
	},
};

/**
 * Select the color at current line and cursor position (CodeMirror)
 * @returns {{from:number,to:number}|null}
 */
export function getColorRange() {
	const { editor } = editorManager;

	try {
		const sel = editor.state.selection.main;
		const from = sel.from;
		const to = sel.to;

		// If there is a selection, validate and return it
		if (from !== to) {
			const text = editor.state.doc.sliceString(from, to);
			if (!isValidColor(text)) return null;
			return { from, to };
		}

		// No selection: find color under cursor in the current line
		const head = sel.head;
		const line = editor.state.doc.lineAt(head);
		const lineText = line.text;
		const col = head - line.from;

		const regex = colorRegex.anyGlobal;
		let match;

		while ((match = regex.exec(lineText))) {
			const startCol = match.index + match[1].length;
			const endCol = startCol + match[2].length;

			if (col >= startCol && col <= endCol) {
				return { from: line.from + startCol, to: line.from + endCol };
			}
		}

		return null;
	} catch {
		return null;
	}
}

export function isValidColor(value) {
	return colorRegex.anyStrict.test(value);
}
