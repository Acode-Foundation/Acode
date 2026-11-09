/**
 * Moves every declaration that uses `color-mix()` into an
 * `@supports (color: color-mix(...))` block placed right after its rule.
 *
 * Why: a declaration containing `var()` is always accepted at parse time, so
 * on WebViews without `color-mix()` it becomes "invalid at computed-value
 * time" and resets to `unset` (usually transparent) instead of falling back to
 * the plain declaration written before it. Guarding it with `@supports` lets
 * old WebViews keep the fallback while newer ones still get the mixed color.
 */
const SUPPORTS = "(color: color-mix(in srgb, red 50%, transparent))";
const HAS_COLOR_MIX = /color-mix\(/i;

const isColorMix = (node) =>
	node.type === "decl" &&
	!node.prop.startsWith("--") &&
	HAS_COLOR_MIX.test(node.value);

const isKeyframes = (node) =>
	node?.type === "atrule" && /keyframes$/i.test(node.name);

const isInsideSupportsGuard = (node) => {
	for (let p = node.parent; p; p = p.parent) {
		if (p.type === "atrule" && p.name === "supports" && p.params === SUPPORTS)
			return true;
	}
	return false;
};

/** @type {import('postcss').PluginCreator} */
module.exports = () => ({
	postcssPlugin: "color-mix-supports",
	OnceExit(root, { AtRule }) {
		const keyframes = new Set();
		const rules = [];

		root.walkRules((rule) => {
			if (isInsideSupportsGuard(rule)) return;
			if (!rule.nodes?.some(isColorMix)) return;
			if (isKeyframes(rule.parent)) keyframes.add(rule.parent);
			else rules.push(rule);
		});

		for (const rule of rules) {
			const guarded = rule.clone({ nodes: [] });
			const decls = rule.nodes.filter(isColorMix);
			for (const decl of decls) {
				// A later declaration of the same property must keep winning.
				if (hasLaterProp(decl, decl.prop)) continue;
				guarded.append(decl.clone());
				decl.remove();
			}
			if (!guarded.nodes.length) continue;
			const supports = new AtRule({ name: "supports", params: SUPPORTS });
			supports.append(guarded);
			rule.after(supports);
			if (!rule.nodes.length) rule.remove();
		}

		// @supports can't go inside @keyframes, so the whole block is duplicated:
		// the original keeps the fallbacks, the guarded copy (later, so it wins)
		// keeps everything.
		for (const atRule of keyframes) {
			const supports = new AtRule({ name: "supports", params: SUPPORTS });
			supports.append(atRule.clone());
			atRule.walkDecls((decl) => {
				if (isColorMix(decl)) decl.remove();
			});
			atRule.after(supports);
		}
	},
});

function hasLaterProp(decl, prop) {
	for (let n = decl.next(); n; n = n.next()) {
		if (n.type === "decl" && n.prop === prop) return true;
	}
	return false;
}

module.exports.postcss = true;
