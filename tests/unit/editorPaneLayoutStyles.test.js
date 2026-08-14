import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import * as sass from "sass";
import { describe, expect, it } from "vitest";

const stylesheetPath = fileURLToPath(
	new URL("../../src/styles/page.scss", import.meta.url),
);

function renderLayout(position = "top") {
	const window = new Window();
	const { document } = window;
	const style = document.createElement("style");
	style.textContent = sass.compile(stylesheetPath).css;
	document.head.append(style);
	document.body.className = "fullscreen-mode";
	document.body.innerHTML = `
		<wc-page id="root" open-file-list-pos="${position}">
			<main>
				<div class="editor-pane-root" data-tabs-position="${position}">
					<section class="editor-pane reserve-fullscreen-tabs-left reserve-fullscreen-tabs-right">
						<ul class="open-file-list editor-pane-tabs"></ul>
					</section>
				</div>
			</main>
			<header></header>
			<span id="sidebar-toggler"></span>
		</wc-page>`;
	return { document, window };
}

describe("fullscreen pane tab layout", () => {
	it("reserves the left navigation and right header controls for top tabs", () => {
		const { document, window } = renderLayout("top");
		const styles = window.getComputedStyle(
			document.querySelector(".editor-pane-tabs"),
		);
		expect(styles.paddingLeft).toBe("40px");
		expect(styles.paddingRight).toBe("100px");
		expect(styles.boxSizing).toBe("border-box");
	});

	it("does not reserve overlay space in bottom pane tabs", () => {
		const { document, window } = renderLayout("bottom");
		const styles = window.getComputedStyle(
			document.querySelector(".editor-pane-tabs"),
		);
		expect(styles.paddingLeft).not.toBe("40px");
		expect(styles.paddingRight).not.toBe("100px");
	});
});
