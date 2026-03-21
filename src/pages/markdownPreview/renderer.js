import markdownIt from "markdown-it";
import anchor from "markdown-it-anchor";
import { full as markdownItEmoji } from "markdown-it-emoji";
import markdownItFootnote from "markdown-it-footnote";
import MarkdownItGitHubAlerts from "markdown-it-github-alerts";
import markdownItTaskLists from "markdown-it-task-lists";
import Url from "utils/Url";

const EXTERNAL_LINK_PATTERN = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
const IMAGE_PLACEHOLDER =
	"data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
const BLOCK_MATH_PATTERN = /(^|[^\\])\$\$[\s\S]+?\$\$/m;
const INLINE_MATH_PATTERN =
	/(^|[^\\])\$(?!\s)(?:\\.|[^$\\\n])*(?:\\[{^_(]|[{^_])(?:\\.|[^$\\\n])*\$(?!\w)/m;
const BEGIN_END_MATH_PATTERN =
	/\\begin\{(?:equation|align|gather|multline|eqnarray)\*?\}[\s\S]*?\\end\{(?:equation|align|gather|multline|eqnarray)\*?\}/m;

let mathModulesPromise = null;
let mathMarkdownItPromise = null;

function slugify(text) {
	return text
		.trim()
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^\p{L}\p{N}]+/gu, "-")
		.replace(/^-+|-+$/g, "");
}

function escapeAttribute(value = "") {
	return String(value)
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function splitLinkTarget(target = "") {
	const hashIndex = target.indexOf("#");
	if (hashIndex === -1) {
		return { path: target, hash: "" };
	}

	return {
		path: target.slice(0, hashIndex),
		hash: target.slice(hashIndex),
	};
}

export function isExternalLink(target = "") {
	return EXTERNAL_LINK_PATTERN.test(String(target).trim());
}

export function isMarkdownPath(target = "") {
	return /\.md(?:[#?].*)?$/i.test(String(target).trim());
}

export function getMarkdownBaseUri(file) {
	if (!file) return "";
	if (file.uri) return file.uri;
	if (file.location && file.filename) {
		return Url.join(file.location, file.filename);
	}
	return file.location || "";
}

export function resolveMarkdownTarget(target = "", baseUri = "") {
	if (!target || target.startsWith("#") || isExternalLink(target)) {
		return target;
	}

	const { path, hash } = splitLinkTarget(target);
	if (!path) return target;

	let resolvedPath = path;
	if (!path.startsWith("/")) {
		const baseDir = baseUri ? Url.dirname(baseUri) : "";
		if (baseDir) {
			resolvedPath = Url.join(baseDir, path);
		}
	}

	return `${resolvedPath}${hash}`;
}

function resolveImageTarget(target = "", baseUri = "") {
	if (
		!target ||
		target.startsWith("#") ||
		target.startsWith("data:") ||
		target.startsWith("blob:") ||
		isExternalLink(target)
	) {
		return null;
	}

	const { path } = splitLinkTarget(target);
	if (!path) return null;

	let resolvedPath = path;
	if (!path.startsWith("/")) {
		const baseDir = baseUri ? Url.dirname(baseUri) : "";
		if (baseDir) {
			resolvedPath = Url.join(baseDir, path);
		}
	}

	return resolvedPath;
}

function collectTokens(tokens, callback) {
	for (const token of tokens) {
		callback(token);
		if (Array.isArray(token.children) && token.children.length) {
			collectTokens(token.children, callback);
		}
	}
}

export function hasMathContent(text = "") {
	return (
		BLOCK_MATH_PATTERN.test(text) ||
		INLINE_MATH_PATTERN.test(text) ||
		BEGIN_END_MATH_PATTERN.test(text)
	);
}

async function getKatexAndTexmathModules() {
	if (!mathModulesPromise) {
		mathModulesPromise = Promise.all([
			import("katex").then(({ default: katex }) => katex),
			import("markdown-it-texmath").then(
				({ default: markdownItTexmath }) => markdownItTexmath,
			),
		]).then(([katex, markdownItTexmath]) => ({
			katex,
			markdownItTexmath,
		}));
		mathModulesPromise = mathModulesPromise.catch((error) => {
			mathModulesPromise = null;
			throw error;
		});
	}

	return mathModulesPromise;
}

function createMarkdownIt({ katex = null, markdownItTexmath = null } = {}) {
	const md = markdownIt({
		html: true,
		linkify: true,
	});

	md.use(MarkdownItGitHubAlerts)
		.use(anchor, { slugify })
		.use(markdownItTaskLists)
		.use(markdownItFootnote);

	if (katex && markdownItTexmath) {
		md.use(markdownItTexmath, {
			engine: katex,
			delimiters: ["dollars", "beg_end"],
			katexOptions: {
				throwOnError: false,
				strict: "ignore",
			},
		});
	}

	md.use(markdownItEmoji);

	md.renderer.rules.image = (tokens, idx, options, env, self) => {
		const token = tokens[idx];
		token.attrSet("loading", "lazy");
		token.attrSet("decoding", "async");

		const src = token.attrGet("src");
		if (src && !src.startsWith("data:") && !isExternalLink(src)) {
			const resolvedPath = resolveImageTarget(src, env.markdownBaseUri);
			if (resolvedPath) {
				token.attrSet("data-markdown-local-src", resolvedPath);
				token.attrSet("src", IMAGE_PLACEHOLDER);
			}
		}

		return self.renderToken(tokens, idx, options);
	};

	md.renderer.rules.fence = (tokens, idx) => {
		const token = tokens[idx];
		const info = (token.info || "").trim();
		const language = info.split(/\s+/)[0].toLowerCase();
		const escapedCode = md.utils.escapeHtml(token.content || "");

		if (language === "mermaid") {
			return `<div class="mermaid">${escapedCode}</div>`;
		}

		const className = language
			? ` class="language-${escapeAttribute(language)}"`
			: "";
		const dataLanguage = ` data-language="${escapeAttribute(language)}"`;

		return `<pre><code${className}${dataLanguage}>${escapedCode}</code></pre>`;
	};

	return md;
}

const baseMarkdownIt = createMarkdownIt();

async function getMarkdownIt(text = "") {
	if (!hasMathContent(text)) {
		return baseMarkdownIt;
	}

	if (!mathMarkdownItPromise) {
		mathMarkdownItPromise = getKatexAndTexmathModules()
			.then(({ katex, markdownItTexmath }) =>
				createMarkdownIt({ katex, markdownItTexmath }),
			)
			.catch((error) => {
				mathMarkdownItPromise = null;
				throw error;
			});
	}

	return mathMarkdownItPromise;
}

export async function renderMarkdown(text, file) {
	const markdownText = text || "";
	const md = await getMarkdownIt(markdownText);
	const env = {};
	env.markdownBaseUri = getMarkdownBaseUri(file);
	const tokens = md.parse(markdownText, env);

	collectTokens(tokens, (token) => {
		if (token.type === "link_open") {
			const href = token.attrGet("href");
			if (!href || href.startsWith("#") || isExternalLink(href)) return;

			token.attrSet(
				"data-resolved-href",
				resolveMarkdownTarget(href, env.markdownBaseUri),
			);
		}
	});

	return {
		html: md.renderer.render(tokens, md.options, env),
	};
}
