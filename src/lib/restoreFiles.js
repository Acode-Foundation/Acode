import EditorFile from "./editorFile";

/**
 *
 * @param {import('./editorFile').FileOptions[]} files
 */
export default async function restoreFiles(files) {
	const hasRenderedFile = files.some((file) => file.render);
	const restoredFiles = files.map((file, index) => {
		const render =
			file.render || (!hasRenderedFile && index === files.length - 1);
		const options = {
			...file,
			render,
			emitUpdate: false,
		};
		return new EditorFile(file.filename, options);
	});

	// Finish restoring every document before startup persistence is enabled.
	// Otherwise the temporary empty sessions can overwrite saved cursor state,
	// and the first visit to an inactive tab visibly flashes a loading editor.
	await Promise.all(restoredFiles.map((file) => file.load?.()));
}
