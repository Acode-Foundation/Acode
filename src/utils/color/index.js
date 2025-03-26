import Hex from "./hex";
import Hsl from "./hsl";
import Rgb from "./rgb";

/**@type {CanvasRenderingContext2D} */
const ctx = (<canvas />).getContext("2d", {
	willReadFrequently: true,
});

export default (/**@type {string}*/ color) => {
	return new Color(color);
};

class Color {
	rgb = new Rgb(0, 0, 0, 1);

	/**
	 * Create a color from a string
	 * @param {string} color
	 */
	constructor(color) {
		const { canvas } = ctx;
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.fillStyle = color;
		ctx.fillRect(0, 0, 1, 1);
		const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
		this.rgb = new Rgb(r, g, b, a / 255);
	}

	darken(ratio) {
		const hsl = Hsl.fromRgb(this.rgb);
		hsl.l = Math.max(0, hsl.l - ratio * hsl.l);
		this.rgb = hsl.rgb;
		return this;
	}

	lighten(ratio) {
		const hsl = Hsl.fromRgb(this.rgb);
		hsl.l = Math.min(1, hsl.l + ratio * hsl.l);
		this.rgb = hsl.rgb;
		return this;
	}

	get isDark() {
		return this.luminance < 0.5;
	}

	get isLight() {
		return this.luminance >= 0.5;
	}

	get lightness() {
		return this.hsl.l;
	}

	/**
	 * Get the luminance of the color
	 * Returns a value between 0 and 1
	 */
	get luminance() {
		let { r, g, b } = this.rgb;
		r /= 255;
		g /= 255;
		b /= 255;
		return 0.2126 * r + 0.7152 * g + 0.0722 * b;
	}

	get hex() {
		return Hex.fromRgb(this.rgb);
	}

	get hsl() {
		return Hsl.fromRgb(this.rgb);
	}
}
