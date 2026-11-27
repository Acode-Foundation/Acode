const fullscreenSelector = ":is(:fullscreen, [data-acode-fullscreen])";

export default function fullscreenStyles(target: HTMLElement) {
	const roots = styleRoots(target);
	const observer = new MutationObserver((records) => {
		if (
			records.some(
				(record) =>
					record.target instanceof HTMLStyleElement ||
					record.target.parentElement instanceof HTMLStyleElement ||
					[...record.addedNodes].some(
						(node) =>
							node instanceof Element &&
							(node.matches("style, link[rel=stylesheet]") ||
								node.querySelector("style, link[rel=stylesheet]")),
					),
			)
		)
			refresh();
	});
	const insertRule = CSSStyleSheet.prototype.insertRule;
	const insertGroupRule = CSSGroupingRule.prototype.insertRule;
	const replaceSync = CSSStyleSheet.prototype.replaceSync;
	const replace = CSSStyleSheet.prototype.replace;
	CSSStyleSheet.prototype.insertRule = function (rule, index) {
		const inserted = insertRule.call(this, rule, index);
		adapt(this.cssRules);
		return inserted;
	};
	CSSGroupingRule.prototype.insertRule = function (rule, index) {
		const inserted = insertGroupRule.call(this, rule, index);
		adapt(this.cssRules);
		return inserted;
	};
	CSSStyleSheet.prototype.replaceSync = function (text) {
		replaceSync.call(this, text);
		adapt(this.cssRules);
	};
	CSSStyleSheet.prototype.replace = async function (text) {
		await replace.call(this, text);
		adapt(this.cssRules);
		return this;
	};
	for (const root of roots) {
		observer.observe(root, {
			childList: true,
			characterData: true,
			subtree: true,
		});
		root.addEventListener("load", refresh, true);
	}
	try {
		refresh();
	} catch (error) {
		dispose();
		throw error;
	}
	return dispose;

	function dispose() {
		observer.disconnect();
		for (const root of roots) root.removeEventListener("load", refresh, true);
		CSSStyleSheet.prototype.insertRule = insertRule;
		CSSGroupingRule.prototype.insertRule = insertGroupRule;
		CSSStyleSheet.prototype.replaceSync = replaceSync;
		CSSStyleSheet.prototype.replace = replace;
	}

	function refresh() {
		for (const root of roots) {
			for (const sheet of [...root.styleSheets, ...root.adoptedStyleSheets]) {
				adapt(readRules(sheet));
			}
		}
	}
}

function styleRoots(target: HTMLElement) {
	const roots = new Set<Document | ShadowRoot>([document]);
	let ancestor: Element = target;
	while (true) {
		if (ancestor.shadowRoot) roots.add(ancestor.shadowRoot);
		const root = ancestor.getRootNode();
		if (!(root instanceof ShadowRoot)) break;
		roots.add(root);
		ancestor = root.host;
	}
	return roots;
}

function readRules(sheet: CSSStyleSheet): Iterable<CSSRule> {
	try {
		return sheet.cssRules;
	} catch (error) {
		if (error instanceof DOMException && error.name === "SecurityError")
			return [];
		throw error;
	}
}

function adapt(rules: Iterable<CSSRule>) {
	for (const rule of rules) {
		if (rule instanceof CSSStyleRule) {
			const selector = adaptSelector(rule.selectorText);
			if (selector !== rule.selectorText) rule.selectorText = selector;
		}
		if ("cssRules" in rule) adapt((rule as CSSGroupingRule).cssRules);
		if (rule.type === CSSRule.IMPORT_RULE && (rule as CSSImportRule).styleSheet)
			adapt(readRules((rule as CSSImportRule).styleSheet!));
	}
}

function adaptSelector(selector: string) {
	let result = "",
		quote = "",
		brackets = 0;
	for (let index = 0; index < selector.length; index++) {
		const char = selector[index];
		if (char === "\\") {
			result += selector.slice(index, index + 2);
			index++;
			continue;
		}
		if (quote) {
			if (char === quote) quote = "";
		} else if (char === '"' || char === "'") quote = char;
		else if (char === "[") brackets++;
		else if (char === "]") brackets--;
		else if (!brackets && selector.startsWith(fullscreenSelector, index)) {
			result += fullscreenSelector;
			index += fullscreenSelector.length - 1;
			continue;
		} else if (
			!brackets &&
			/^:fullscreen(?![\w-])/i.test(selector.slice(index))
		) {
			result += fullscreenSelector;
			index += ":fullscreen".length - 1;
			continue;
		}
		result += char;
	}
	return result;
}
