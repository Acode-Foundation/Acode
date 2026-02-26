import { executeCommand, getRegisteredCommands } from "cm/commandRegistry";
import palette from "components/palette";
import helpers from "utils/helpers";

export default async function commandPalette() {
	const recentCommands = RecentlyUsedCommands();
	const { editor } = editorManager;
	const wasFocused = editor?.hasFocus ?? false;

	palette(generateHints, onselect, strings["type command"], () => {
		if (wasFocused) editor?.focus();
	});

	function generateHints() {
		const registeredCommands = getRegisteredCommands();
		const hints = [];

		registeredCommands.forEach(({ name, description, key }) => {
			const keyLabel = key ? key.split("|")[0] : "";
			const item = (recentlyUsed) => ({
				value: name,
				text: `<span ${recentlyUsed ? `data-str='${strings["recently used"]}'` : ""}>${description ?? name}</span><small>${keyLabel}</small>`,
			});
			if (recentCommands.commands.includes(name)) {
				hints.unshift(item(true));
				return;
			}
			hints.push(item(false));
		});

		return hints;
	}

	function onselect(value) {
		const executed = executeCommand(value, editorManager.editor);
		if (executed) recentCommands.push(value);
	}
}

function RecentlyUsedCommands() {
	return {
		/**
		 * @returns {string[]}
		 */
		get commands() {
			return (
				helpers.parseJSON(localStorage.getItem("recentlyUsedCommands")) || []
			);
		},
		/**
		 * Saves command to recently used commands
		 * @param {string} command Command name
		 * @returns {void}
		 */
		push(command) {
			const { commands } = this;
			if (commands.length > 10) {
				commands.pop();
			}
			if (commands.includes(command)) {
				commands.splice(commands.indexOf(command), 1);
			}
			commands.unshift(command);
			localStorage.setItem("recentlyUsedCommands", JSON.stringify(commands));
		},
	};
}
