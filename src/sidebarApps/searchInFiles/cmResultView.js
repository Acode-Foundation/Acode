import { EditorState, StateEffect, StateField } from "@codemirror/state";
import {
	Decoration,
	EditorView,
	ViewPlugin,
	WidgetType,
} from "@codemirror/view";
import appSettings from "lib/settings";
import helpers from "utils/helpers";

/**
 * CodeMirror view to render search results
 *
 * @param {HTMLElement} container
 * @param {object} opts
 * @param {(lineIndex:number)=>void} opts.onLineClick
 * @param {()=>string[]} opts.getWords - returns list of words to highlight
 * @param {()=>string[]} opts.getFileNames - returns list of filenames (used to style header lines)
 */
export function createSearchResultView(
	container,
	{ onLineClick, getWords, getFileNames, getRegex },
) {
	let view;

	// Effect and field to maintain collapsed headers (by line number)
	const toggleFold = StateEffect.define();
	const foldState = StateField.define({
		create() {
			return new Set();
		},
		update(value, tr) {
			let next = value;
			for (const e of tr.effects) {
				if (e.is(toggleFold)) {
					if (next === value) next = new Set(value);
					const ln = e.value;
					if (next.has(ln)) next.delete(ln);
					else next.add(ln);
				}
			}
			// Reset folds on full document reset
			if (tr.docChanged && tr.startState.doc.length === 0) return new Set();
			return next;
		},
	});

	function eachGroup(doc, fn) {
		// Groups start at lines not beginning with a tab
		const total = doc.lines;
		let start = 1;
		while (start <= total) {
			const header = doc.line(start);
			// If header starts with tab, advance until a non-tab header
			if (header.text.startsWith("\t")) {
				start++;
				continue;
			}
			let end = start;
			for (let i = start + 1; i <= total; i++) {
				const line = doc.line(i);
				if (!line.text.startsWith("\t")) break;
				end = i;
			}
			fn({ start, end });
			start = end + 1;
		}
	}

	class ChevronWidget extends WidgetType {
		constructor(collapsed) {
			super();
			this.collapsed = collapsed;
		}
		eq(other) {
			return other.collapsed === this.collapsed;
		}
		toDOM() {
			const span = document.createElement("span");
			span.className = `cm-foldChevron icon keyboard_arrow_${this.collapsed ? "right" : "down"}`;
			return span;
		}
		ignoreEvent() {
			return false;
		}
	}

	class SummaryWidget extends WidgetType {
		constructor(text) {
			super();
			this.text = text;
		}
		eq(other) {
			return other.text === this.text;
		}
		toDOM() {
			const div = document.createElement("div");
			div.className = "cm-collapsedSummary";
			div.textContent = this.text;
			return div;
		}
		ignoreEvent() {
			return false;
		}
	}

	class CountWidget extends WidgetType {
		constructor(count) {
			super();
			this.count = count;
		}
		eq(other) {
			return other.count === this.count;
		}
		toDOM() {
			const span = document.createElement("span");
			span.className = "cm-fileCount";
			span.textContent = `(${this.count})`;
			return span;
		}
		ignoreEvent() {
			return true;
		}
	}

	class FileIconWidget extends WidgetType {
		constructor(className) {
			super();
			this.className = className;
		}
		eq(other) {
			return other.className === this.className;
		}
		toDOM() {
			const span = document.createElement("span");
			span.className = `${this.className} cm-fileIcon`;
			return span;
		}
		ignoreEvent() {
			return false;
		}
	}

	function buildGroupDecos(state) {
		const doc = state.doc;
		const folded = state.field(foldState, false) || new Set();
		// No removed groups
		const fns =
			(typeof getFileNames === "function" ? getFileNames() : []) || [];
		if (!fns.length || doc.length === 0 || doc.lines === 0)
			return Decoration.none;

		const builder = [];
		// Build header chevrons and collapses per group
		let groupIndex = 0;
		eachGroup(doc, ({ start, end }) => {
			const header = doc.line(start);
			const key = start - 1;
			const collapsed = folded.has(key); // zero-based line index
			// Header line class and chevron widget
			builder.push(
				Decoration.line({ class: "cm-fileName" }).range(header.from),
			);
			builder.push(
				Decoration.widget({
					widget: new ChevronWidget(collapsed),
					side: -1,
				}).range(header.from),
			);
			// File icon
			const fileNames =
				(typeof getFileNames === "function" ? getFileNames() : []) || [];
			const fname = fileNames[groupIndex] || "";
			const iconClass = helpers.getIconForFile(fname);
			builder.push(
				Decoration.widget({
					widget: new FileIconWidget(iconClass),
					side: -1,
				}).range(header.from),
			);
			// Count badge on right
			const count = Math.max(0, end - start);
			builder.push(
				Decoration.widget({ widget: new CountWidget(count), side: 1 }).range(
					header.to,
				),
			);

			if (collapsed && end > start) {
				// Hide content lines and show a summary placeholder
				const first = doc.line(start + 1);
				const last = doc.line(end);
				builder.push(
					Decoration.replace({ block: true }).range(first.from, last.to),
				);
				const count2 = end - start;
				builder.push(
					Decoration.widget({
						widget: new SummaryWidget(
							`${count2} result${count2 > 1 ? "s" : ""}`,
						),
						side: 1,
						block: true,
					}).range(first.from),
				);
			}
			groupIndex++;
		});

		return Decoration.set(builder, true);
	}

	const groupDecoField = StateField.define({
		create(state) {
			return buildGroupDecos(state);
		},
		update(decos, tr) {
			if (
				tr.docChanged ||
				tr.startState.field(foldState, false) !==
					tr.state.field(foldState, false)
			) {
				return buildGroupDecos(tr.state);
			}
			return decos.map(tr.changes);
		},
		provide: (f) => EditorView.decorations.from(f),
	});

	const decorationsPlugin = ViewPlugin.fromClass(
		class {
			constructor(view) {
				this.decorations = this.buildDecos(view);
			}

			update(update) {
				if (
					update.docChanged ||
					update.viewportChanged ||
					update.startState.field(foldState) !== update.state.field(foldState)
				) {
					this.decorations = this.buildDecos(update.view);
				}
			}

			buildDecos(view) {
				const builder = [];
				let searchRegex = null;
				if (typeof getRegex === "function") {
					const r = getRegex();
					if (r && r.source) {
						const flags = (r.ignoreCase ? "i" : "") + "g";
						try {
							searchRegex = new RegExp(r.source, flags);
						} catch {}
					}
				}
				const words = searchRegex ? [] : (getWords?.() || []).filter(Boolean);

				let wordRegex = null;
				if (!searchRegex && words.length) {
					const escaped = words
						.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
						.join("|");
					try {
						wordRegex = new RegExp(escaped, "g");
					} catch {}
				}
				// Add match highlights only on visible lines to keep it fast
				const matcher = searchRegex || wordRegex;
				if (matcher) {
					for (const { from, to } of view.visibleRanges) {
						let pos = from;
						while (pos <= to) {
							const line = view.state.doc.lineAt(pos);
							const text = line.text;
							if (text && text.charCodeAt(0) === 9) {
								matcher.lastIndex = 0;
								let m;
								while ((m = matcher.exec(text))) {
									const fromPos = line.from + m.index;
									const toPos = fromPos + m[0].length;
									builder.push(
										Decoration.mark({ class: "cm-match" }).range(
											fromPos,
											toPos,
										),
									);
									if (m.index === matcher.lastIndex) matcher.lastIndex++;
								}
							}
							if (line.to >= to) break;
							pos = line.to + 1;
						}
					}
				}

				return Decoration.set(builder, true);
			}
		},
		{
			decorations: (v) => v.decorations,
			eventHandlers: {
				mousedown(event, view) {
					// Map click to line number and notify (use client coords)
					const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
					if (pos == null) return;
					// Only react when clicking on a line element, not empty space
					const lineEl =
						event.target && event.target.closest
							? event.target.closest(".cm-line")
							: null;
					if (!lineEl) return;
					const ln = view.state.doc.lineAt(pos).number - 1; // zero-based
					const lineText = view.state.doc.line(ln + 1).text;
					const isHeader = lineText.length > 0 && lineText.charCodeAt(0) !== 9;
					if (isHeader) {
						// Toggle collapse on header click
						view.dispatch({ effects: toggleFold.of(ln) });
						return;
					}
					// Only trigger navigation for match lines (start with tab)
					if (!(lineText && lineText.charCodeAt(0) === 9)) return;
					onLineClick?.(ln);
				},
			},
		},
	);

	const readOnly = EditorState.readOnly.of(true);
	const lineWrap = EditorView.lineWrapping;
	const noCursor = EditorView.editable.of(false);

	function getEditorFontFamily() {
		const font = appSettings?.value?.editorFont || "Roboto Mono";
		return `${font}, Noto Mono, Monaco, monospace`;
	}

	const theme = EditorView.theme({
		"&": {
			fontSize: String(appSettings?.value?.fontSize || "12px"),
			lineHeight: String(appSettings?.value?.lineHeight || 1.5),
		},
		".cm-content": {
			padding: 0,
			fontFamily: getEditorFontFamily(),
		},
		".cm-line": {
			color: "var(--primary-text-color)",
		},
	});

	const state = EditorState.create({
		doc: "",
		extensions: [
			EditorState.tabSize.of(1),
			readOnly,
			noCursor,
			lineWrap,
			theme,
			foldState,
			groupDecoField,
			decorationsPlugin,
		],
	});

	view = new EditorView({ state, parent: container });

	return {
		setValue(text) {
			view.dispatch({
				changes: { from: 0, to: view.state.doc.length, insert: text || "" },
			});
		},
		insert(text) {
			if (!text) return;
			view.dispatch({ changes: { from: view.state.doc.length, insert: text } });
		},
		setGhostText(text) {
			this.setValue(text || "");
		},
		removeGhostText() {
			this.setValue("");
		},
		get view() {
			return view;
		},
	};
}
