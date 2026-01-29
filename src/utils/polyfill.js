export default function loadPolyFill() {
	if (!("isConnected" in Node.prototype)) {
		Object.defineProperty(Node.prototype, "isConnected", {
			get() {
				return (
					!this.ownerDocument ||
					!(
						this.ownerDocument.compareDocumentPosition(this) &
						this.DOCUMENT_POSITION_DISCONNECTED
					)
				);
			},
		});
	}

	if (!DOMTokenList.prototype.replace) {
		DOMTokenList.prototype.replace = function (a, b) {
			if (this.contains(a)) {
				this.add(b);
				this.remove(a);
				return true;
			}
			return false;
		};
	}

	if (!HTMLElement.prototype.append) {
		HTMLElement.prototype.append = function (...nodes) {
			nodes.map((node) => this.appendChild(node));
		};
	}

	if (!HTMLElement.prototype.remove) {
		HTMLElement.prototype.remove = function () {
			this.parentElement.removeChild(this);
		};
	}

	if (!HTMLElement.prototype.getParent) {
		HTMLElement.prototype.getParent = function (queryString) {
			const $$ = [...document.querySelectorAll(queryString)];
			for (let $ of $$) if ($.contains(this)) return $;
			return null;
		};
	}

	if (!String.prototype.hashCode) {
		Object.defineProperty(String.prototype, "hashCode", {
			value: function () {
				const str = this.toString();
				const len = str.length;

				if (len === 0) return "0";

				// Produces a 48-char hex string (192 bits)
				const FNV_PRIME = 0x01000193;
				const FNV_OFFSET = 0x811c9dc5;

				// Generate 6 different 32-bit hashes with different seeds/offsets
				const hashes = [];
				for (let pass = 0; pass < 6; pass++) {
					let hash = FNV_OFFSET ^ (pass * 0x1234567);

					for (let i = 0; i < len; i++) {
						const char = str.charCodeAt(i);
						// XOR with byte and multiply by prime
						hash ^= char;
						hash = Math.imul(hash, FNV_PRIME);
						// Mix in position and pass for additional entropy
						hash ^= (i + pass) & 0xff;
						hash = Math.imul(hash, FNV_PRIME);
					}

					// Additional mixing
					hash ^= len;
					hash = Math.imul(hash, FNV_PRIME);
					hash ^= hash >>> 16;

					hashes.push((hash >>> 0).toString(16).padStart(8, "0"));
				}

				return hashes.join("");
			},
		});
	}

	if (!String.prototype.subtract) {
		Object.defineProperty(String.prototype, "subtract", {
			value: function (str) {
				return this.replace(new RegExp("^" + str), "");
			},
		});
	}

	if (!String.prototype.capitalize) {
		Object.defineProperty(String.prototype, "capitalize", {
			value: function (index) {
				if (typeof index === "number" && index >= 0) {
					const strs = [
						this.slice(0, index),
						this.slice(index, index + 1),
						this.slice(index + 1),
					];
					return strs[0] + (strs[1] ? strs[1].toUpperCase() : "") + strs[2];
				} else {
					let strs = this.split(" ");
					strs = strs.map((str) => {
						if (str.length > 0) return str[0].toUpperCase() + str.slice(1);
						return "";
					});
					return strs.join(" ");
				}
			},
		});
	}
}
