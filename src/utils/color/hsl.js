import Rgb from "./rgb";

export default class Hsl {
	h = 0;
	s = 0;
	l = 0;
	a = 1;

	/**
	 * HSL color constructor
	 * @param {number} h Hue value between 0 and 1
	 * @param {number} s Saturation value between 0 and 1
	 * @param {number} l Lightness value between 0 and 1
	 * @param {number} a Alpha value between 0 and 1
	 */
	constructor(h, s, l, a = 1) {
		this.h = h;
		this.s = s;
		this.l = l;
		this.a = a;
	}

	/**
	 * Creates an HSL color from an RGB color
	 * @param {Rgb} rgb
	 * @returns
	 */
	static fromRgb(rgb) {
		let { r, g, b, a } = rgb;
		r /= 255;
		g /= 255;
		b /= 255;

		const max = Math.max(r, g, b);
		const min = Math.min(r, g, b);
		const l = (max + min) / 2;
		let h = 0;
		let s = 0;

		if (max !== min) {
			const d = max - min;
			s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
			switch (max) {
				case r:
					h = (g - b) / d + (g < b ? 6 : 0);
					break;
				case g:
					h = (b - r) / d + 2;
					break;
				case b:
					h = (r - g) / d + 4;
					break;
			}
			h /= 6;
		}

		return new Hsl(h, s, l, a);
	}

	/**
	 * Gets the color as a string
	 * @param {boolean} [alpha] Whether to include alpha
	 * @returns
	 */
	toString(alpha) {
		const hsl = () => `hsl(${this.hValue}, ${this.sValue}%, ${this.lValue}%)`;
		const hsla = () =>
			`hsla(${this.hValue}, ${this.sValue}%, ${this.lValue}%, ${this.a})`;
		if (alpha === undefined) {
			return this.a === 1 ? hsl() : hsla();
		}

		return alpha ? hsla() : hsl();
	}

	get hValue() {
		return this.h * 360;
	}

	get sValue() {
		return this.s * 100;
	}

	get lValue() {
		return this.l * 100;
	}

	get lightness() {
		return this.lValue;
	}

	get hue() {
		return this.hValue;
	}

	get saturation() {
		return this.sValue;
	}

	/**
	 * Gets the color as an rgb object
	 * @returns {Rgb}
	 */
	get rgb() {
		if (this.l === 0) {
			return new Rgb(0, 0, 0, this.a);
		}

		if (this.l === 1) {
			return new Rgb(255, 255, 255, this.a);
		}

		// now convert hsl value to rgb
		const c = (1 - Math.abs(2 * this.l - 1)) * this.s;
		const x = c * (1 - Math.abs(((this.h * 6) % 2) - 1));
		const m = this.l - c / 2;
		let r = 0;
		let g = 0;
		let b = 0;

		if (this.h < 1 / 6) {
			r = c;
			g = x;
		} else if (this.h < 2 / 6) {
			r = x;
			g = c;
		} else if (this.h < 3 / 6) {
			g = c;
			b = x;
		} else if (this.h < 4 / 6) {
			g = x;
			b = c;
		} else if (this.h < 5 / 6) {
			r = x;
			b = c;
		} else {
			r = c;
			b = x;
		}

		r = Math.round((r + m) * 255);
		g = Math.round((g + m) * 255);
		b = Math.round((b + m) * 255);

		return new Rgb(r, g, b, this.a);
	}
}
