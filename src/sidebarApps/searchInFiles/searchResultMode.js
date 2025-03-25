export const words = [];
export const fileNames = [];

ace.define(
	"ace/mode/search_result_highlight_rules",
	[
		"require",
		"exports",
		"module",
		"ace/lib/oop",
		"ace/mode/text_highlight_rules",
	],
	(require, exports, module) => {
		const oop = require("../lib/oop");
		const { TextHighlightRules } = require("./text_highlight_rules");

		function SearchHighlightRules() {
			this.$rules = {
				start: [
					{
						token: "file_name",
						get regex() {
							return fileNames.join("|");
						},
					},
					{
						token: "highlight",
						get regex() {
							return words.join("|");
						},
					},
					{
						token: "string", // multi line string start
						regex: /[|>][-+\d]*(?:$|\s+(?:$|#))/,
						onMatch: function (val, state, stack, line) {
							line = line.replace(/ #.*/, "");
							var indent = /^ *((:\s*)?-(\s*[^|>])?)?/
								.exec(line)[0]
								.replace(/\S\s*$/, "").length;
							var indentationIndicator = Number.parseInt(
								/\d+[\s+-]*$/.exec(line),
							);

							if (indentationIndicator) {
								indent += indentationIndicator - 1;
								this.next = "mlString";
							} else {
								this.next = "mlStringPre";
							}
							if (!stack.length) {
								stack.push(this.next);
								stack.push(indent);
							} else {
								stack[0] = this.next;
								stack[1] = indent;
							}
							return this.token;
						},
						next: "mlString",
					},
				],
				mlStringPre: [
					{
						token: "indent",
						regex: /^ *$/,
					},
					{
						token: "indent",
						regex: /^ */,
						onMatch: function (val, state, stack) {
							var curIndent = stack[1];

							if (curIndent >= val.length) {
								this.next = "start";
								stack.shift();
								stack.shift();
							} else {
								stack[1] = val.length - 1;
								this.next = stack[0] = "mlString";
							}
							return this.token;
						},
						next: "mlString",
					},
				],
				mlString: [
					{
						token: "indent",
						regex: /^ *$/,
					},
					{
						token: "indent",
						regex: /^ */,
						onMatch: function (val, state, stack) {
							var curIndent = stack[1];

							if (curIndent >= val.length) {
								this.next = "start";
								stack.splice(0);
							} else {
								this.next = "mlString";
							}
							return this.token;
						},
						next: "mlString",
					},
				],
			};
			this.normalizeRules();
		}
		oop.inherits(SearchHighlightRules, TextHighlightRules);
		exports.SearchHighlightRules = SearchHighlightRules;
	},
);

define("ace/mode/folding/search_result_fold", [
	"require",
	"exports",
	"module",
	"ace/lib/oop",
	"ace/mode/folding/fold_mode",
	"ace/range",
], (require, exports, module) => {
	const oop = require("ace/lib/oop");
	const { FoldMode: BaseFoldMode } = require("./fold_mode");
	const { Range } = require("ace/range");

	function FoldMode() {}
	oop.inherits(FoldMode, BaseFoldMode);
	exports.FoldMode = FoldMode;

	(function () {
		this.getFoldWidgetRange = function (session, foldStyle, row) {
			var range = this.indentationBlock(session, row);
			if (range) return range;
			var re = /\S/;
			var line = session.getLine(row);
			var startLevel = line.search(re);
			if (startLevel === -1 || line[startLevel] !== "#") return;
			var startColumn = line.length;
			var maxRow = session.getLength();
			var startRow = row;
			var endRow = row;
			while (++row < maxRow) {
				line = session.getLine(row);
				var level = line.search(re);
				if (level === -1) continue;
				if (line[level] !== "#") break;
				endRow = row;
			}
			if (endRow > startRow) {
				var endColumn = session.getLine(endRow).length;
				return new Range(startRow, startColumn, endRow, endColumn);
			}
		};
		this.getFoldWidget = (session, foldStyle, row) => {
			var line = session.getLine(row);
			var indent = line.search(/\S/);
			var next = session.getLine(row + 1);
			var prev = session.getLine(row - 1);
			var prevIndent = prev.search(/\S/);
			var nextIndent = next.search(/\S/);
			if (indent === -1) {
				session.foldWidgets[row - 1] =
					prevIndent !== -1 && prevIndent < nextIndent ? "start" : "";
				return "";
			}
			if (prevIndent === -1) {
				if (
					indent === nextIndent &&
					line[indent] === "#" &&
					next[indent] === "#"
				) {
					session.foldWidgets[row - 1] = "";
					session.foldWidgets[row + 1] = "";
					return "start";
				}
			} else if (
				prevIndent === indent &&
				line[indent] === "#" &&
				prev[indent] === "#"
			) {
				if (session.getLine(row - 2).search(/\S/) === -1) {
					session.foldWidgets[row - 1] = "start";
					session.foldWidgets[row + 1] = "";
					return "";
				}
			}
			if (prevIndent !== -1 && prevIndent < indent)
				session.foldWidgets[row - 1] = "start";
			else session.foldWidgets[row - 1] = "";
			if (indent < nextIndent) return "start";
			else return "";
		};
	}).call(FoldMode.prototype);
});

ace.define(
	"ace/mode/search_result",
	[
		"require",
		"exports",
		"module",
		"ace/lib/oop",
		"ace/mode/text",
		"ace/mode/folding/search_result_fold",
		"ace/search_result_highlight_rules",
	],
	(require, exports, module) => {
		const oop = require("ace/lib/oop");
		const { Mode: TextMode } = require("./text");
		const { SearchHighlightRules } = require("./search_result_highlight_rules");
		const { FoldMode } = require("./folding/search_result_fold");

		function Mode() {
			this.$id = "ace/mode/search_result";
			this.HighlightRules = SearchHighlightRules;
			this.foldingRules = new FoldMode();
		}
		oop.inherits(Mode, TextMode);
		exports.Mode = Mode;
	},
);
