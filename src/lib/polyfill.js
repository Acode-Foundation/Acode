// polyfill for Object.hasOwn

(function () {
	var oldHasOwn = Function.prototype.call.bind(Object.prototype.hasOwnProperty);
	if (oldHasOwn(Object, "hasOwn")) return;
	Object.defineProperty(Object, "hasOwn", {
		configurable: true,
		enumerable: false,
		writable: true,
		value: function hasOwn(obj, prop) {
			return oldHasOwn(obj, prop);
		},
	});
	Object.hasOwn.prototype = null;
})();

// polyfill for prepend

(function (arr) {
	arr.forEach(function (item) {
		if (Object.hasOwn(item, "prepend")) return;
		Object.defineProperty(item, "prepend", {
			configurable: true,
			enumerable: false,
			writable: true,
			value: function prepend() {
				var ownerDocument = this.ownerDocument || this;
				var docFrag = ownerDocument.createDocumentFragment();

				var argLength = arguments.length;
				for (var i = 0; i < argLength; i++) {
					var argItem = arguments[i];
					docFrag.appendChild(
						argItem instanceof Node
							? argItem
							: ownerDocument.createTextNode(argItem),
					);
				}

				this.insertBefore(docFrag, this.firstChild);
			},
		});
		item.prepend.prototype = null;
	});
})([Element.prototype, Document.prototype, DocumentFragment.prototype]);

// polyfill for closest

(function (arr) {
	arr.forEach(function (item) {
		if (Object.hasOwn(item, "closest")) return;
		Object.defineProperty(item, "closest", {
			configurable: true,
			enumerable: false,
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
		item.closest.prototype = null;
	});
})([Element.prototype]);

// polyfill for replaceWith

(function (arr) {
	arr.forEach(function (item) {
		var className = item.name;
		var proto = item.prototype;
		if (Object.hasOwn(proto, "replaceWith")) return;
		Object.defineProperty(proto, "replaceWith", {
			configurable: true,
			enumerable: false,
			writable: true,
			value: function replaceWith() {
				var parent = this.parentNode;
				if (!parent) return;
				var viableNextSibling = this.nextSibling;
				var argLength = arguments.length;
				while (viableNextSibling) {
					var inArgs = false;
					for (var j = 0; j < argLength; j++) {
						if (arguments[j] === viableNextSibling) {
							inArgs = true;
							break;
						}
					}
					if (!inArgs) break;
					viableNextSibling = viableNextSibling.nextSibling;
				}
				var ownerDocument = this.ownerDocument || this;
				var docFrag = ownerDocument.createDocumentFragment();
				var nodes = [];
				for (var i = 0; i < argLength; i++) {
					var currentNode = arguments[i];
					if (!(currentNode instanceof Node)) {
						nodes[i] = currentNode + "";
						continue;
					}
					var ancestor = parent;
					do {
						if (ancestor !== currentNode) continue;
						throw new DOMException(
							"Failed to execute 'replaceWith' on '" +
								className +
								"': The new child element contains the parent.",
							"HierarchyRequestError",
						);
					} while ((ancestor = ancestor.parentNode));
					nodes[i] = currentNode;
				}
				var isItselfInFragment;
				for (var i = 0; i < argLength; i++) {
					var currentNode = nodes[i];
					if (typeof currentNode === "string") {
						currentNode = ownerDocument.createTextNode(currentNode);
					} else if (currentNode === this) {
						isItselfInFragment = true;
					}
					docFrag.appendChild(currentNode);
				}
				if (!isItselfInFragment) this.remove();
				if (argLength >= 1) {
					parent.insertBefore(docFrag, viableNextSibling);
				}
			},
		});
		proto.replaceWith.prototype = null;
	});
})([Element, CharacterData, DocumentType]);

// polyfill for toggleAttribute

(function (arr) {
	arr.forEach(function (item) {
		if (Object.hasOwn(item, "toggleAttribute")) return;
		Object.defineProperty(item, "toggleAttribute", {
			configurable: true,
			enumerable: false,
			writable: true,
			value: function toggleAttribute(attr, force) {
				if (this.hasAttribute(attr)) {
					if (force && force !== undefined) return true;
					this.removeAttribute(attr);
					return false;
				} else {
					if (!force && force !== undefined) return false;
					this.setAttribute(attr, "");
					return true;
				}
			},
		});
		item.toggleAttribute.prototype = null;
	});
})([Element.prototype]);

// polyfill for performance.now

(function () {
	if ("performance" in window === false) {
		window.performance = {};
	}

	Date.now =
		Date.now ||
		function () {
			// thanks IE8
			return new Date().getTime();
		};

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

// polyfill for Promise.withResolvers

if (!Object.hasOwn(Promise, "withResolvers")) {
	Object.defineProperty(Promise, "withResolvers", {
		configurable: true,
		enumerable: false,
		writable: true,
		value: function withResolvers() {
			var resolve, reject;
			var promise = new this(function (_resolve, _reject) {
				resolve = _resolve;
				reject = _reject;
			});
			if (typeof resolve !== "function" || typeof reject !== "function") {
				throw new TypeError(
					"Promise resolve or reject function is not callable",
				);
			}
			return {
				promise: promise,
				resolve: resolve,
				reject: reject,
			};
		},
	});
	Promise.withResolvers.prototype = null;
}
