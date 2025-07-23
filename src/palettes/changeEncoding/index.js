import fsOperation from "fileSystem";
import palette from "components/palette";
import confirm from "dialogs/confirm";
import encodings from "utils/encodings";

export default function changeEncoding() {
	palette(generateHints, reopenWithNewEncoding, strings.encoding);
}

function generateHints() {
	return Object.keys(encodings).map((id) => {
		const encoding = encodings[id];
		const aliases = encoding.aliases.join(", ");
		return {
			value: id,
			text: `<div class="palette-content-encoding">
      <span>${encoding.label}</span>
      <small>${aliases}</small>
    <div>`,
		};
	});
}

export async function reopenWithNewEncoding(encoding) {
	const file = editorManager.activeFile;
	const editor = editorManager.editor;
	const message = strings["change encoding"]
		.replace("{file}", file.filename)
		.replace("{encoding}", encoding);
	const confirmation = await confirm(strings.warning, message);

	if (!confirmation) return;

	const text = await fsOperation(file.uri).readFile(encoding);
	const cursorPosition = editor.getCursorPosition();

	file.encoding = encoding;
	file.session.setValue(text);
	file.isUnsaved = false;
	file.markChanged = false;
	editor.moveCursorToPosition(cursorPosition);

	editorManager.onupdate("encoding");
	editorManager.emit("update", "encoding");
}
