import { html } from "@codemirror/lang-html";
import {
	javascript,
	tsxLanguage,
	typescriptLanguage,
} from "@codemirror/lang-javascript";
import {
	LRLanguage,
	LanguageSupport,
	foldInside,
	foldNodeProp,
	indentNodeProp,
} from "@codemirror/language";
import { parseMixed } from "@lezer/common";
import { styleTags, tags as t } from "@lezer/highlight";
import { parser } from "./parser/parser";

export function astro(config: { autoCloseTags?: boolean } = {}): LanguageSupport {
	const htmlSupport = html({
		autoCloseTags: config.autoCloseTags,
		matchClosingTags: false,
		selfClosingTags: true,
	});
	const jsSupport = javascript({ jsx: true, typescript: true });

	const astroParser = parser.configure({
		props: [
			styleTags({
				"FrontmatterOpen FrontmatterClose": t.meta,
				"ExpressionOpen ExpressionClose": t.brace,
			}),
			foldNodeProp.add({
				Frontmatter: foldInside,
				AstroExpression: foldInside,
			}),
			indentNodeProp.add({
				Frontmatter: (context) => context.column(context.node.from),
				AstroExpression: (context) => context.column(context.node.from),
			}),
		],
		wrap: parseMixed((node) => {
			if (node.type.isTop) {
				return {
					parser: htmlSupport.language.parser,
					overlay: (overlayNode) => overlayNode.name === "HtmlContent",
				};
			}

			if (node.name === "FrontmatterContent") {
				return { parser: typescriptLanguage.parser };
			}

			if (node.name === "ExpressionContent") {
				return { parser: tsxLanguage.parser };
			}

			return null;
		}),
	});

	const astroLanguage = LRLanguage.define({
		name: "astro",
		parser: astroParser,
		languageData: {
			commentTokens: { block: { open: "<!--", close: "-->" } },
			indentOnInput: /^\s*(?:<\/[\w:-]+>|[})\]]|---)\s*$/,
			wordChars: "-_:",
		},
	});

	return new LanguageSupport(astroLanguage, [htmlSupport.support, jsSupport.support]);
}
