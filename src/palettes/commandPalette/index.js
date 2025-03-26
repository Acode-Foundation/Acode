import palette from "components/palette";
import helpers from "utils/helpers";

export default async function commandPalette() {
	const recentCommands = RecentlyUsedCommands();
	const { editor } = editorManager;
	const commands = Object.values(editor.commands.commands);

	const isEditorFocused = editor.isFocused();

	palette(generateHints, onselect, strings["type command"], () => {
		if (isEditorFocused) editor.focus();
	});

	function generateHints() {
		const hints = [];

		for (const { name, description, bindKey } of commands) {
			/**
			 * @param {boolean} recentlyUsed Is the command recently used
			 * @returns {{value: string, text: string}}
			 */
			const item = (recentlyUsed) => ({
				value: name,
				text: `<span ${recentlyUsed ? `data-str='${strings["recently used"]}'` : ""}>${description ?? name}</span><small>${bindKey?.win ?? ""}</small>`,
			});
			if (recentCommands.commands.includes(name)) {
				hints.unshift(item(true));
				continue;
			}
			hints.push(item());
		}

		return hints;
	}

	function onselect(value) {
		const command = commands.find(({ name }) => name === value);
		if (!command) return;
		recentCommands.push(value);
		command.exec(editorManager.editor);
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
