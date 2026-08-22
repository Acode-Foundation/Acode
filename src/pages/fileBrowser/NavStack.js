import Url from "utils/Url";

/**
 * @typedef {{url: string, name: string}} Location
 */

export default class NavStack extends EventTarget {
	static {
		Object.defineProperty(this.prototype, Symbol.toStringTag, {
			value: "NavStack",
			configurable: true,
		});
	}

	get length() {
		return this.#arr.length;
	}
	toJSON() {
		return this.#arr.map((obj) => ({ ...obj }));
	}
	on() {
		return this.addEventListener(...arguments);
	}
	off() {
		return this.removeEventListener(...arguments);
	}

	/** @type {null | { added: Map<string, string>, removed: Set<string> }} */
	#updatedURLs;
	#queueUpdateEvent() {
		if (this.#updatedURLs) return;
		const added = new Map();
		const removed = new Set();
		this.#updatedURLs = Object.freeze({ added, removed });
		queueMicrotask(() => {
			this.#updatedURLs = null;
			this.dispatchEvent(
				new CustomEvent("update", {
					detail: Object.freeze({
						get added() {
							return added.entries();
						},
						get removed() {
							return removed.values();
						},
					}),
				}),
			);
		});
	}

	/** @type {Set<string>} */
	#urlSet = new Set();
	/** @type {Array<Location>} */
	#arr = [];
	/**
	 * @param {{ url: string, name?: string } | string} url
	 * @param {string} [name]
	 */
	push(url, name) {
		if (typeof url === "object") ({ url, name } = url);
		if (!(url = `${url ?? ""}`)) {
			throw new TypeError(
				"NavStack.prototype.push(" +
					"url: { url: string, name?: string } | string, name?: string): \n" +
					'"url" is either missing, null or undefined, or resolves to an empty string.',
			);
		}
		const urlSet = this.#urlSet;
		if (urlSet.has(url)) return;
		urlSet.add(url);
		name = `${name ?? ""}` || Url.basename(url) || url;
		const arr = this.#arr;
		const i = arr.length;
		arr[i] = { url, name };

		this.#queueUpdateEvent();
		const { added, removed } = this.#updatedURLs;
		if (removed.has(url)) removed.delete(url);
		else added.set(url, { name, index: i });
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

			this.#queueUpdateEvent();
			const { added, removed } = this.#updatedURLs;
			if (!added.has(url2)) removed.add(url2);
			else added.delete(url2);

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
}
