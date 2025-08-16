import "./style.scss";
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
		/**@type {[]} */
		const annotations = file.session?.getAnnotations();
		if (!annotations.length) return;

		$content.append(
			<details open="true" className="single-file">
				<summary>{`${file.name} (${annotations.length})`}</summary>
				<div className="problems">
					{annotations.map((annotation) => {
						let icon = "info";

						switch (annotation.type) {
							case "error":
								icon = "cancel";
								break;

							case "warning":
								icon = "warningreport_problem";
								break;

							default:
								break;
						}

						return (
							<div
								className="problem"
								data-action="goto"
								data-file-id={file.id}
								annotation={annotation}
							>
								<span className={`icon ${icon}`}></span>
								<span data-type={annotation.type} className="problem-message">
									{annotation.text}
								</span>
								<span className="problem-line">
									{annotation.row + 1}:{annotation.column + 1}
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
		const $target = e.target;
		const { action } = $target.dataset;

		if (action === "goto") {
			const { fileId } = $target.dataset;
			const annotation = $target.annotation;

			editorManager.switchFile(fileId);
			editorManager.editor.gotoLine(annotation.row + 1, annotation.column);
			$page.hide();

			setTimeout(() => {
				editorManager.editor.focus();
			}, 100);
		}
	}
}
