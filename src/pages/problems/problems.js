import "./style.scss";
import { getLspDiagnostics } from "cm/lsp/diagnostics";
import Page from "components/page";
import actionStack from "lib/actionStack";
import EditorFile from "lib/editorFile";
import helpers from "utils/helpers";

export default function Problems() {
	const $page = Page(strings["problems"]);
	/**@type {EditorFile[]} */
	const files = editorManager.files;
	const $content = <div id="problems"></div>;

	files.forEach((file) => {
		if (file.type !== "editor") return;
		const annotations = collectAnnotations(file);
		if (!annotations.length) return;

		const title = `${file.name} (${annotations.length})`;
		$content.append(
			<details open="true" className="single-file">
				<summary>{title}</summary>
				<div className="problems">
					{annotations.map((annotation) => {
						const { type, text, row, column } = annotation;
						const icon = getIconForType(type);

						return (
							<div
								className="problem"
								data-action="goto"
								data-file-id={file.id}
								annotation={annotation}
							>
								<span className={`icon ${icon}`}></span>
								<span data-type={type} className="problem-message">
									{text}
								</span>
								<span className="problem-line">
									{row + 1}:{column + 1}
								</span>
							</div>
						);
					})}
				</div>
			</details>,
		);
	});

	$content.addEventListener("click", clickHandler);
	$page.body = $content;
	app.append($page);
	helpers.showAd();

	$page.onhide = function () {
		helpers.hideAd();
		actionStack.remove("problems");
	};

	actionStack.push({
		id: "problems",
		action: $page.hide,
	});

	/**
	 * Click handler for problems page
	 * @param {MouseEvent} e
	 */
	function clickHandler(e) {
		const $target = e.target.closest("[data-action='goto']");
		if (!$target) return;
		const { action } = $target.dataset;

		if (action === "goto") {
			const { fileId } = $target.dataset;
			const annotation = $target.annotation;
			if (!annotation) return;
			const row = normalizeIndex(annotation.row);
			const column = normalizeIndex(annotation.column);

			editorManager.switchFile(fileId);
			editorManager.editor.gotoLine(row + 1, column);
			$page.hide();

			setTimeout(() => {
				editorManager.editor.focus();
			}, 100);
		}
	}

	function collectAnnotations(file) {
		const annotations = [];
		const { session } = file;
		const isActiveFile = editorManager.activeFile?.id === file.id;
		const state =
			isActiveFile && editorManager.editor
				? editorManager.editor.state
				: session;

		if (session && typeof session.getAnnotations === "function") {
			const aceAnnotations = session.getAnnotations() || [];
			for (const item of aceAnnotations) {
				if (!item) continue;
				const row = normalizeIndex(item.row);
				const column = normalizeIndex(item.column);
				annotations.push({
					row,
					column,
					text: item.text || "",
					type: normalizeSeverity(item.type),
				});
			}
		}

		if (state && typeof state.field === "function") {
			annotations.push(...readLspAnnotations(state));
		}

		return annotations;
	}

	function readLspAnnotations(state) {
		const diagnostics = getLspDiagnostics(state);
		if (!diagnostics.length) return [];

		const doc = state.doc;
		if (!doc || typeof doc.lineAt !== "function") return [];

		return diagnostics
			.map((diagnostic) => {
				const start = clampPosition(diagnostic.from, doc.length);
				let row = 0;
				let column = 0;
				try {
					const line = doc.lineAt(start);
					row = Math.max(0, line.number - 1);
					column = Math.max(0, start - line.from);
				} catch (_) {}

				let message = diagnostic.message || "";
				if (diagnostic.source) {
					message = message
						? `${message} (${diagnostic.source})`
						: diagnostic.source;
				}

				return {
					row: normalizeIndex(row),
					column: normalizeIndex(column),
					text: message,
					type: normalizeSeverity(diagnostic.severity),
				};
			})
			.filter((annotation) => annotation.text);
	}

	function clampPosition(pos, length) {
		if (typeof pos !== "number" || Number.isNaN(pos)) return 0;
		return Math.max(0, Math.min(pos, Math.max(0, length)));
	}

	function normalizeIndex(value) {
		if (typeof value === "number" && Number.isFinite(value)) {
			return Math.max(0, value);
		}
		const parsed = Number(value);
		if (Number.isFinite(parsed)) {
			return Math.max(0, parsed);
		}
		return 0;
	}

	function normalizeSeverity(severity) {
		switch (severity) {
			case "error":
			case "fatal":
				return "error";
			case "warn":
			case "warning":
				return "warning";
			default:
				return "info";
		}
	}

	function getIconForType(type) {
		switch (type) {
			case "error":
				return "cancel";
			case "warning":
				return "warningreport_problem";
			default:
				return "info";
		}
	}
}
