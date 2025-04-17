const BATCH_SIZE = 500;

export default class AceRainbowBrackets {
	constructor() {
		this.bracketPairs = [
			{ open: "(", close: ")", type: "paren" },
			{ open: "[", close: "]", type: "bracket" },
			{ open: "{", close: "}", type: "curly" },
		];

		this.colors = [
			"#ffd700", // Gold
			"#f472b6", // Pink
			"#57afff", // Blue
			"#7ce38b", // Green
			"#fb7185", // Red
			"#1edac1", // Teal
		];

		this.ignoredTokenTypes = [
			"comment",
			"string",
			"regexp",
			"keyword",
			"doctype",
			"tag.doctype",
			"tag.comment",
			"text.xml",
			"string.regexp",
			"string.quoted",
			"string.single",
			"string.double",
		];

		this.styleId = "ace-rainbow-brackets-style";
		this.visibleRows = null;
		this.disposeHandler = null;
	}

	init(editor) {
		if (!editor) return null;

		this.injectStyles();

		this.isColorizationInProgress = false;
		this.pendingColorization = false;
		this.debounceTimeout = null;

		const changeHandler = () => this.colorizeRainbowBrackets(editor);
		const scrollHandler = () => {
			this.updateVisibleRows(editor);
			this.colorizeRainbowBrackets(editor);
		};
		const afterRender = () => this.colorizeRainbowBrackets(editor);

		editor.on("change", changeHandler);
		editor.session.on("changeScrollTop", scrollHandler);
		editor.renderer.on("afterRender", afterRender);

		// Initial run
		this.updateVisibleRows(editor);
		this.colorizeRainbowBrackets(editor);

		this.disposeHandler = {
			dispose: () => {
				editor.off("change", changeHandler);
				editor.session.off("changeScrollTop", scrollHandler);
				editor.renderer.off("afterRender", afterRender);
				this.clearTokenStyles(editor);
				editor.renderer.updateFull();
				this.removeStyles();
			},
		};

		return this.disposeHandler;
	}

	injectStyles() {
		const existingStyle = document.getElementById(this.styleId);
		if (existingStyle) {
			existingStyle.remove();
		}

		const style = document.createElement("style");
		style.id = this.styleId;
		style.type = "text/css";

		const css = this.colors
			.map((color, i) => `.rainbow-level-${i} { color: ${color} !important; }`)
			.join("\n");

		style.textContent = css;
		document.head.appendChild(style);
	}

	shouldIgnoreToken(tokenType) {
		if (!tokenType) return false;
		return this.ignoredTokenTypes.some((ignored) =>
			tokenType.includes(ignored),
		);
	}

	removeStyles() {
		const style = document.getElementById(this.styleId);
		if (style) style.remove();
	}

	colorizeRainbowBrackets(editor) {
		if (this.debounceTimeout) {
			clearTimeout(this.debounceTimeout);
		}

		this.debounceTimeout = setTimeout(() => {
			if (this.isColorizationInProgress) {
				this.pendingColorization = true;
				return;
			}

			this.isColorizationInProgress = true;
			this.pendingColorization = false;

			// Process in chunks for large documents
			this.processColorizationInChunks(editor, () => {
				this.isColorizationInProgress = false;
				if (this.pendingColorization) {
					this.colorizeRainbowBrackets(editor);
				}
			});
		}, 100);
	}

	processColorizationInChunks(editor, callback) {
		const session = editor.getSession();
		const doc = session.getDocument();
		const totalRows = doc.getLength();

		this.clearTokenStyles(editor);

		const bracketStack = [];

		const openBracketMap = {};
		const closeBracketMap = {};
		this.bracketPairs.forEach((pair) => {
			openBracketMap[pair.open] = pair;
			closeBracketMap[pair.close] = pair;
		});

		// Store bracket positions and info
		const allBracketsInfo = [];

		// First pass: find all valid bracket pairs
		for (let row = 0; row < totalRows; row++) {
			const tokens = session.bgTokenizer?.lines[row] || [];

			let columnOffset = 0;
			for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
				const token = tokens[tokenIndex];
				const tokenType = token.type || "";
				const tokenValue = token.value || "";

				if (!this.shouldIgnoreToken(tokenType)) {
					for (let i = 0; i < tokenValue.length; i++) {
						const char = tokenValue[i];
						const column = columnOffset + i;

						if (openBracketMap[char]) {
							const pairInfo = openBracketMap[char];
							bracketStack.push({
								row: row,
								column: column,
								tokenIndex: tokenIndex,
								char: char,
								pairType: pairInfo.type,
								closingChar: pairInfo.close,
							});
						} else if (closeBracketMap[char]) {
							const pairInfo = closeBracketMap[char];
							const matchingOpenChar = pairInfo.open;

							let found = false;
							for (let j = bracketStack.length - 1; j >= 0; j--) {
								if (bracketStack[j].char === matchingOpenChar) {
									const openingBracket = bracketStack.splice(j, 1)[0];
									const level = j;

									allBracketsInfo.push({
										row: openingBracket.row,
										column: openingBracket.column,
										tokenIndex: openingBracket.tokenIndex,
										char: openingBracket.char,
										level: level,
										pairType: openingBracket.pairType,
									});

									allBracketsInfo.push({
										row: row,
										column: column,
										tokenIndex: tokenIndex,
										char: char,
										level: level,
										pairType: pairInfo.type,
									});

									found = true;
									break;
								}
							}
						}
					}
				}

				columnOffset += tokenValue.length;
			}
		}

		this.processBatch(editor, allBracketsInfo, callback);
	}

	processBatch(editor, allBracketsInfo, callback) {
		let currentIndex = 0;

		const processBatchChunk = () => {
			const endIndex = Math.min(
				currentIndex + BATCH_SIZE,
				allBracketsInfo.length,
			);
			const batch = allBracketsInfo.slice(currentIndex, endIndex);

			for (const info of batch) {
				this.applyColorToBracket(
					editor,
					info.row,
					info.column,
					info.level % this.colors.length,
				);
			}

			currentIndex = endIndex;

			if (currentIndex < allBracketsInfo.length) {
				setTimeout(processBatchChunk, 0);
			} else {
				editor.renderer.updateFull();
				if (callback) callback();
			}
		};

		processBatchChunk();
	}

	applyColorToBracket(editor, row, column, colorLevel) {
		const session = editor.getSession();
		const tokens = session.bgTokenizer?.lines[row];
		if (!tokens) return;

		let tokenCol = 0;
		for (let i = 0; i < tokens.length; i++) {
			const token = tokens[i];
			const tokenEnd = tokenCol + token.value.length;

			if (column >= tokenCol && column < tokenEnd) {
				if (this.shouldIgnoreToken(token.type)) {
					return;
				}

				if (token.value.length === 1) {
					if (!token.type.includes(`rainbow-level-${colorLevel}`)) {
						token.type += ` rainbow-level-${colorLevel}`;
					}
				} else {
					const relativePos = column - tokenCol;
					const valueBefore = token.value.substring(0, relativePos);
					const bracketChar = token.value.charAt(relativePos);
					const valueAfter = token.value.substring(relativePos + 1);

					const newTokens = [];

					if (valueBefore) {
						newTokens.push({
							type: token.type,
							value: valueBefore,
						});
					}

					newTokens.push({
						type: `${token.type} rainbow-level-${colorLevel}`,
						value: bracketChar,
					});

					if (valueAfter) {
						newTokens.push({
							type: token.type,
							value: valueAfter,
						});
					}

					tokens.splice(i, 1, ...newTokens);
				}

				editor.renderer.updateLines(row, row);
				return;
			}

			tokenCol = tokenEnd;
		}
	}

	updateVisibleRows(editor) {
		const firstRow = editor.renderer.getFirstVisibleRow();
		const lastRow = editor.renderer.getLastVisibleRow();
		this.visibleRows = { first: firstRow, last: lastRow };
	}

	clearTokenStyles(editor) {
		const session = editor.getSession();
		const doc = session.getDocument();

		for (let row = 0; row < doc.getLength(); row++) {
			if (session.bgTokenizer?.lines[row]) {
				for (const token of session.bgTokenizer.lines[row]) {
					token.type = token.type.replace(/\s*rainbow-level-\d+/g, "");
				}
				editor.renderer.updateLines(row, row);
			}
		}
	}

	dispose() {
		if (this.disposeHandler) {
			this.disposeHandler.dispose();
			this.disposeHandler = null;
		}
	}
}
