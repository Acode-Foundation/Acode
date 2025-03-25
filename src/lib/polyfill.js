// polyfill for prepend

((arr) => {
	arr.forEach((item) => {
		if (item.hasOwnProperty("prepend")) {
			return;
		}
		Object.defineProperty(item, "prepend", {
			configurable: true,
			enumerable: true,
			writable: true,
			value: function prepend() {
				var argArr = Array.prototype.slice.call(arguments),
					docFrag = document.createDocumentFragment();

				argArr.forEach((argItem) => {
					var node =
						argItem instanceof Node
							? argItem
							: document.createTextNode(String(argItem));
					docFrag.appendChild(node);
				});

				this.insertBefore(docFrag, this.firstChild);
			},
		});
	});
})([Element.prototype, Document.prototype, DocumentFragment.prototype]);

// polyfill for closest

((arr) => {
	arr.forEach((item) => {
		if (item.hasOwnProperty("closest")) {
			return;
		}
		Object.defineProperty(item, "closest", {
			configurable: true,
			enumerable: true,
			writable: true,
			value: function closest(s) {
				var matches = (this.document || this.ownerDocument).querySelectorAll(s),
					i,
					el = this;
				do {
					i = matches.length;
					while (--i >= 0 && matches.item(i) !== el) {}
				} while (i < 0 && (el = el.parentElement));
				return el;
			},
		});
	});
})([Element.prototype]);

// polyfill for replaceWith

((arr) => {
	arr.forEach((item) => {
		if (item.hasOwnProperty("replaceWith")) {
			return;
		}
		Object.defineProperty(item, "replaceWith", {
			configurable: true,
			enumerable: true,
			writable: true,
			value: function replaceWith() {
				var parent = this.parentNode,
					i = arguments.length,
					currentNode;
				if (!parent) return;
				if (!i)
					// if there are no arguments
					parent.removeChild(this);
				while (i--) {
					// i-- decrements i and returns the value of i before the decrement
					currentNode = arguments[i];
					if (typeof currentNode !== "object") {
						currentNode = this.ownerDocument.createTextNode(currentNode);
					} else if (currentNode.parentNode) {
						currentNode.parentNode.removeChild(currentNode);
					}
					// the value of "i" below is after the decrement
					if (!i)
						// if currentNode is the first argument (currentNode === arguments[0])
						parent.replaceChild(currentNode, this);
					// if currentNode isn't the first
					else parent.insertBefore(this.previousSibling, currentNode);
				}
			},
		});
	});
})([Element.prototype, CharacterData.prototype, DocumentType.prototype]);

// polyfill for toggleAttribute

((arr) => {
	arr.forEach((item) => {
		if (item.hasOwnProperty("toggleAttribute")) {
			return;
		}
		Object.defineProperty(item, "toggleAttribute", {
			configurable: true,
			enumerable: true,
			writable: true,
			value: function toggleAttribute() {
				var attr = arguments[0];
				if (this.hasAttribute(attr)) {
					this.removeAttribute(attr);
				} else {
					this.setAttribute(attr, arguments[1] || "");
				}
			},
		});
	});
})([Element.prototype]);

// polyfill for performance.now

(() => {
	if ("performance" in window === false) {
		window.performance = {};
	}

	Date.now =
		Date.now ||
		(() => {
			// thanks IE8
			return new Date().getTime();
		});

	if ("now" in window.performance === false) {
		var nowOffset = Date.now();

		if (performance.timing && performance.timing.navigationStart) {
			nowOffset = performance.timing.navigationStart;
		}

		window.performance.now = function now() {
			return Date.now() - nowOffset;
		};
	}
})();
