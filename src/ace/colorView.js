/**
 * Some part of this code belongs to github.com/easylogic and is licensed under MIT
 * @see https://github.com/easylogic/ace-colorpicker/blob/main/src/extension/ace/colorview.js
 */

import Color from "utils/color";
import {
	HEX,
	HSL,
	HSLA,
	isValidColor,
	NAMED_COLORS,
	RGB,
	RGBA,
} from "utils/color/regex";

const COLORPICKER_TOKEN_CLASS = ".ace_color";
const changedRules = [];

let editor = null;

/**
 * Initialize color view
 * @param {AceAjax.Editor} e Editor instance
 * @param {boolean} [force=false] Force update color view
 */
export default function initColorView(e, force = false) {
	editor = e;
	const { renderer } = editor;

	editor.on("changeMode", onChangeMode);
	renderer.on("afterRender", afterRender);

	if (force) {
		const { files } = editorManager;

		if (Array.isArray(files)) {
			files.forEach((file) => {
				if (file.session) {
					file.session._addedColorRule = false;
				}
			});
		}

		onChangeMode();
	}
}

export function deactivateColorView() {
	const { renderer } = editor;

	changedRules.forEach((rule) => rule.shift());
	changedRules.length = 0;
	forceTokenizer();

	editor.off("changeMode", onChangeMode);
	renderer.off("afterRender", afterRender);
}

/**
 * Checks if the session supports color
 * @param {AceAjax.IEditSession} session
 * @returns
 */
function sessionSupportsColor(session) {
	const mode = session.getMode().$id.split("/").pop();
	return /css|less|scss|sass|stylus|html|svg|dart/.test(mode) ? mode : false;
}

function onChangeMode() {
	const session = editor.session;
	let forceUpdate = false;

	// if mode is not css, scss, sass, less, stylus, or html, return
	const mode = sessionSupportsColor(session);
	if (session._addedColorRule || !mode) {
		return;
	}

	let rules = session.$mode.$highlightRules.getRules();

	if (mode === "css") {
		rules = { ruleset: rules["ruleset"] };
	} else if (mode === "html") {
		rules = { "css-ruleset": rules["css-ruleset"] };
	} else if (mode === "svg") {
		const svgColorAttrs = [
			"fill",
			"stroke",
			"stop-color",
			"flood-color",
			"lighting-color",
		];
		Object.keys(rules).forEach((key) => {
			const rule = rules[key];
			if (Array.isArray(rule)) {
				rule.unshift({
					token: "color",
					regex: `(?<=\\b(?:${svgColorAttrs.join("|")})\\s*=\\s*["'])(${HEX}|${RGB}|${RGBA}|${HSL}|${HSLA}|\\w+)(?=["'])`,
				});
				rule.unshift({
					token: "color",
					regex: `(?<=style\\s*=\\s*["'][^"']*(?:${svgColorAttrs.join("|")})\\s*:\\s*)(${HEX}|${RGB}|${RGBA}|${HSL}|${HSLA}|\\w+)(?=\\s*[;'"])`,
				});
				changedRules.push(rule);
				forceUpdate = true;
			}
		});
	}

	Object.keys(rules).forEach((key) => {
		const rule = rules[key];
		if (Array.isArray(rule)) {
			const ruleExists = rule.some((r) => r.token === "color");
			if (ruleExists) return;
			forceUpdate = true;
			rule.unshift({
				token: "color",
				regex: `${HEX}|${RGB}|${RGBA}|${HSL}|${HSLA}`,
			});
			changedRules.push(rule);
			return;
		}
	});

	if (!forceUpdate) return;

	forceTokenizer();
}

function afterRender() {
	const { session, renderer } = editor;
	const { content } = renderer;
	let classes = COLORPICKER_TOKEN_CLASS;

	// if session is css, scss, less, sass, stylus, or html (with css mode), continue

	const mode = sessionSupportsColor(session);
	if (!mode) {
		return;
	}

	if (mode === "scss") {
		classes += ",.ace_function";
	}

	content
		.getAll(COLORPICKER_TOKEN_CLASS)
		.forEach((/**@type {HTMLElement} */ el, i, els) => {
			let content = el.textContent;
			const previousContent = els[i - 1]?.textContent;
			const nextContent = els[i + 1]?.textContent;
			const multiLinePrev = previousContent + content;
			const multiLineNext = content + nextContent;

			if (el.dataset.modified === "true") return;
			el.dataset.modified = "true";

			if (mode === "svg" && content in NAMED_COLORS) {
				content = NAMED_COLORS[content];
			}

			if (!isValidColor(content)) {
				if (isValidColor(multiLinePrev)) {
					content = multiLinePrev;
				} else if (isValidColor(multiLineNext)) {
					content = multiLineNext;
				} else {
					return;
				}
			}

			try {
				const fontColorString =
					Color(content).luminance > 0.5 ? "#000" : "#fff";
				el.classList.add("ace_color");
				el.style.cssText = `background-color: ${content}; color: ${fontColorString}; pointer-events: all;`;
			} catch (error) {
				window.log("error", `Invalid color: ${content}`);
				window.log("error", error);
			}
		});
}

function forceTokenizer() {
	const { session } = editor;
	// force recreation of tokenizer
	session.$mode.$tokenizer = null;
	session.bgTokenizer.setTokenizer(session.$mode.getTokenizer());
	// force re-highlight whole document
	session.bgTokenizer.start(0);
}
