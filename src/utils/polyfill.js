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
			for (const $ of $$) if ($.contains(this)) return $;
			return null;
		};
	}

	if (!String.prototype.hashCode) {
		Object.defineProperty(String.prototype, "hashCode", {
			value: function () {
				let hash = 0;
				for (let i = 0; i < this.length; i++) {
					const chr = this.charCodeAt(i);
					hash = (hash << 5) - hash + chr;
					hash |= 0; // Convert to 32bit integer
				}
				return Math.abs(hash) + (hash < 0 ? "N" : "");
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
