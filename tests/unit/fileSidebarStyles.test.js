import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import * as sass from "sass";
import { describe, expect, it } from "vitest";

const stylesheetPath = fileURLToPath(
	new URL("../../src/sidebarApps/files/style.scss", import.meta.url),
);

function renderFileTreeStyles() {
	const window = new Window();
	const { document } = window;
	const style = document.createElement("style");

	style.textContent = sass.compile(stylesheetPath).css;
	document.head.append(style);
	document.body.innerHTML = `
		<div class="container files">
			<div class="list collapsible">
				<div class="tile" data-type="root">
					<span class="text" id="root-folder-name">
						A-VERY-LONG-ROOT-FOLDER-NAME
					</span>
				</div>
				<ul class="file-tree">
					<li class="tile" data-type="file">
						<span class="text" id="nested-file-name">
							A-VERY-LONG-NESTED-FILE-NAME.js
						</span>
					</li>
				</ul>
			</div>
		</div>
	`;

	return { document, window };
}

describe("file sidebar label overflow", () => {
	it("truncates root folder names without changing nested row scrolling", () => {
		const { document, window } = renderFileTreeStyles();
		const rootStyles = window.getComputedStyle(
			document.getElementById("root-folder-name"),
		);
		const nestedStyles = window.getComputedStyle(
			document.getElementById("nested-file-name"),
		);

		expect(rootStyles.minWidth).toBe("0");
		expect(rootStyles.width).toBe("auto");
		expect(rootStyles.overflow).toBe("hidden");
		expect(rootStyles.textOverflow).toBe("ellipsis");

		expect(nestedStyles.width).toBe("max-content");
		expect(nestedStyles.overflow).toBe("visible");
		expect(nestedStyles.textOverflow).toBe("clip");
	});
});
