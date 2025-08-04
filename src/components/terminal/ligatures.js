// pretty basic ligature implementation for webview
export default class LigaturesAddon {
	constructor(options = {}) {
		// fallback ligatures if a font does not support ligatures natively
		this._fallbackLigatures =
			options.fallbackLigatures ||
			[
				"<--",
				"<---",
				"<<-",
				"<-",
				"->",
				"->>",
				"-->",
				"--->",
				"<==",
				"<===",
				"<<=",
				"<=",
				"=>",
				"=>>",
				"==>",
				"===>",
				">=",
				">>=",
				"<->",
				"<-->",
				"<--->",
				"<---->",
				"<=>",
				"<==>",
				"<===>",
				"<====>",
				"<~~",
				"<~",
				"~>",
				"~~>",
				"::",
				":::",
				"==",
				"!=",
				"===",
				"!==",
				":=",
				":-",
				":+",
				"<*",
				"<*>",
				"*>",
				"<|",
				"<|>",
				"|>",
				"+:",
				"-:",
				"=:",
				":>",
				"++",
				"+++",
				"<!--",
				"<!---",
				"<***>",
			].sort((a, b) => b.length - a.length);
		this._characterJoinerId = undefined;
		this._terminal = undefined;
	}

	activate(terminal) {
		this._terminal = terminal;
		this._characterJoinerId = terminal.registerCharacterJoiner(
			this._joinCharacters.bind(this),
		);
		terminal.element.style.fontFeatureSettings = `"liga" on, "calt" on`;
	}

	dispose() {
		if (this._characterJoinerId !== undefined) {
			this._terminal?.deregisterCharacterJoiner(this._characterJoinerId);
			this._characterJoinerId = undefined;
		}
		if (this._terminal?.element) {
			this._terminal.element.style.fontFeatureSettings = "";
		}
	}

	_joinCharacters(text) {
		return this._findLigatureRanges(text, this._fallbackLigatures);
	}

	_findLigatureRanges(text, ligatures) {
		const ranges = [];
		for (let i = 0; i < text.length; i++) {
			for (const ligature of ligatures) {
				if (text.startsWith(ligature, i)) {
					ranges.push([i, i + ligature.length]);
					i += ligature.length - 1;
					break;
				}
			}
		}
		return ranges;
	}
}
