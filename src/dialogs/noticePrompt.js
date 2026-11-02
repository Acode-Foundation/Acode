import "./style.scss";

import Page from "components/page";
import actionStack from "lib/actionStack";
import restoreTheme from "lib/restoreTheme";

/**
 * A decision that must be read before it is answered: a page rather than a
 * modal box, so long messages and their buttons are never hidden behind the
 * system navigation bar or the keyboard.
 *
 * Used for SSH host key verification, where the message is a fingerprint the
 * reader has to compare and the buttons are the whole point of the screen.
 *
 * @typedef {object} NoticePromptOptions
 * @property {string} [lead] Icon glyph for the header
 * @property {Array<{text: string, value: any, primary?: boolean, destructive?: boolean}>} buttons
 *   The last button is the trailing (primary) one.
 * @property {string} [note] Small print shown below the buttons
 * @property {() => void} [oncancel] Called when dismissed without choosing
 *
 * @param {string} title
 * @param {string} message Plain text; line breaks and `label: value` pairs are formatted
 * @param {NoticePromptOptions} options
 * @returns {Promise<any>} The chosen button's value, or undefined when dismissed
 */
export default function noticePrompt(title, message, options = {}) {
	const { buttons = [], note, oncancel } = options;

	return new Promise((resolve) => {
		// The header keeps Page's own back arrow: replacing the lead would remove
		// the only way to decline, which is the whole point of the screen.
		const $page = Page(title);
		$page.classList.add("notice-prompt");

		const $content = <div className="notice-content"></div>;
		const $title = (
			<strong className="notice-title">{strings.warning || "Attention"}</strong>
		);
		const $body = <div className="notice-message"></div>;
		appendMessage($body, message);
		$content.append($title, $body);

		if (note) {
			$content.append(<p className="notice-note">{note}</p>);
		}

		// The buttons sit at the end of the scrolling content, on a surface of
		// their own, so they stay reachable however long the message is.
		const $actions = <div className="notice-actions"></div>;
		for (const button of buttons) {
			const $button = tag("button", { textContent: button.text });
			if (button.primary) $button.classList.add("primary");
			if (button.destructive) $button.classList.add("destructive");
			$button.onclick = () => close(button.value);
			$actions.append($button);
		}
		$content.append($actions);

		$page.body = $content;
		app.append($page);

		// A page needs its own Back entry so the hardware key does not fall
		// through to whatever screen opened the connection.
		actionStack.push({ id: "notice-prompt", action: cancel });
		restoreTheme(true);

		function appendMessage($parent, text) {
			const lines = String(text || "").split("\n");
			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed) {
					$parent.append(<div className="notice-gap"></div>);
					continue;
				}

				// "Fingerprint: SHA256:..." renders as a labelled value, and the
				// value itself in a monospace selectable block, because comparing
				// it by eye is the point of the screen.
				const match = /^([A-Za-z][\w ()/-]{1,40}):\s*(.+)$/.exec(trimmed);
				if (match) {
					$parent.append(
						<div className="notice-row">
							<span className="notice-label">{match[1]}</span>
							<code className="notice-value">{match[2]}</code>
						</div>,
					);
				} else {
					$parent.append(<p className="notice-text">{trimmed}</p>);
				}
			}
		}

		let closed = false;

		function close(value) {
			if (closed) return;
			closed = true;
			actionStack.remove("notice-prompt");
			restoreTheme();
			// Page.hide() runs its exit animation and removes the node itself.
			$page.hide();
			resolve(value);
		}

		function cancel() {
			if (closed) return;
			oncancel?.();
			close(undefined);
		}
	});
}
