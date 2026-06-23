export function canSaveFile(file = editorManager.activeFile) {
	return (
		file?.type === "editor" &&
		typeof file.save === "function" &&
		typeof file.saveAs === "function"
	);
}

export default canSaveFile;
