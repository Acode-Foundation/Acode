import Url from "utils/Url";

/**
 * @typedef {import("./fileBrowser.js").Location} Location
 */

export default class NavStack extends EventTarget {
	static {
		Object.defineProperty(this.prototype, Symbol.toStringTag, {
			value: "NavStack",
			configurable: true,
		});
	}

	/** @type {Set<string>} */
	#urlSet = new Set();
	/** @type {Array<Location>} */
	#arr = [];
	/**
	 * @param {{ url: string, name?: string }}
	 */
	push({ url, name }) {
		if (!(url = `${url ?? ""}`)) {
			throw new TypeError(
				"NavStack.prototype.push({ url: string, name?: string }): \n" +
					'"url" is either missing, null or undefined, or resolves to an empty string.',
			);
		}
		const urlSet = this.#urlSet;
		if (urlSet.has(url)) return;
		urlSet.add(url);
		name = `${name ?? ""}` || Url.basename(url) || url;
		this.#arr.push({ url, name });
		this.dispatchEvent(
			new CustomEvent("push", {
				detail: { url, name },
			}),
		);
	}
	/**
	 * @param {string} [url]
	 */
	#popUntil(url) {
		const urlSet = this.#urlSet;
		const arr = this.#arr;
		for (let i = arr.length - 1; i >= 0; i--) {
			const item = arr[i];
			const url2 = item.url;
			if (url && url === url2) return;
			this.#urlSet.delete(url2);
			arr.length = i;
			this.dispatchEvent(
				new CustomEvent("pop", {
					detail: { url: url2, name: item.name },
				}),
			);
			if (!url) return;
		}
	}
	/**
	 * @param {string} url
	 */
	popUntil(url) {
		if ((url = `${url ?? ""}`)) return this.#popUntil(url);
		throw new TypeError(
			"NavStack.prototype.popUntil(url: string): \n" +
				'"url" is either missing, null or undefined, or resolves to an empty string.',
		);
	}
	pop() {
		return this.#popUntil();
	}
	/**
	 * @param {number} i
	 * @returns {Location}
	 */
	get(i) {
		if ((i = +i) !== i) {
			throw new TypeError(
				'NavStack.prototype.get(i: number): "i" is either missing or resolves to NaN.',
			);
		}
		const arr = this.#arr;
		const l = arr.length;
		if (i < 0) i += l;
		if (i < 0 || i > l - 1) return;
		return { ...arr[i] };
	}
	has(url) {
		return this.#urlSet.has(`${url ?? ""}`);
	}
	/** @returns {number} */
	get length() {
		return this.#arr.length;
	}
	/** @returns {Array<Location>} */
	toJSON() {
		return this.#arr.map((obj) => ({ ...obj }));
	}
	on() {
		return this.addEventListener(...arguments);
	}
	off() {
		return this.removeEventListener(...arguments);
	}
}
