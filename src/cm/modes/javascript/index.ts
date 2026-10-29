import { javascript } from "@codemirror/lang-javascript";
import { LanguageSupport, LRLanguage } from "@codemirror/language";
import { styleTags, tags as t } from "@lezer/highlight";
import { memberProperty } from "../../highlightTags";
import { jsdocWrap } from "../jsdoc";

const highlightTags = styleTags({
	// Lezer tags class and interface method names like property definitions;
	// tag them as functions so themes can colour methods like other editors.
	"MethodDeclaration/PropertyDefinition MethodDeclaration/PrivatePropertyDefinition MethodType/PropertyDefinition":
		t.function(t.definition(t.propertyName)),
	// Method calls keep their more specific `function(propertyName)` rule.
	PropertyName: memberProperty,
	PropertyDefinition: t.definition(memberProperty),
});

/**
 * JavaScript/TypeScript support with JSDoc highlighting inside `/** *\/`
 * comments, method names tagged as functions and property names tagged as
 * {@link memberProperty}.
 */
export function javascriptSupport(
	config: { jsx?: boolean; typescript?: boolean } = {},
): LanguageSupport {
	const support = javascript(config);
	const language = support.language;
	if (!(language instanceof LRLanguage)) return support;
	return new LanguageSupport(
		language.configure({ props: [highlightTags], wrap: jsdocWrap }),
		support.support,
	);
}
