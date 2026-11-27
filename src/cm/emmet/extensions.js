import { Prec } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import {
	abbreviationTracker,
	emmetConfig,
	expandAbbreviation,
	wrapWithAbbreviation,
} from "@emmetio/codemirror6-plugin";

export { emmetCompletionSource } from "@emmetio/codemirror6-plugin";

/**
 * Emmet's editor extensions for one syntax.
 * @param {string} syntax
 * @param {{tracker?: object, config?: object}} [options]
 */
export function createEmmetExtensions(syntax, { tracker = {}, config } = {}) {
	const { autocompleteTab = ["markup", "stylesheet"], ...restOverrides } =
		config || {};
	return [
		Prec.high(abbreviationTracker({ syntax, ...tracker })),
		wrapWithAbbreviation(),
		keymap.of([{ key: "Mod-e", run: expandAbbreviation }]),
		emmetConfig.of({ syntax, autocompleteTab, ...restOverrides }),
	];
}
