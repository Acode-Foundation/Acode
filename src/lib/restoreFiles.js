import EditorFile from "./editorFile";

/**
 *
 * @param {import('./editorFile').FileOptions[]} files
 */
export default async function restoreFiles(files) {
	const hasRenderedFile = files.some((file) => file.render);
	const localLoads = [];

	files.forEach((file, index) => {
		const render =
			file.render || (!hasRenderedFile && index === files.length - 1);
		const options = {
			...file,
			render,
			emitUpdate: false,
		};
		const restoredFile = new EditorFile(file.filename, options);
		const load = Promise.resolve(restoredFile.load?.());

		if (file.uri && !/^(?:file|content):/i.test(file.uri)) {
			void load.catch((error) => {
				console.warn(`Failed to preload restored file: ${file.uri}`, error);
			});
			return;
		}

		localLoads.push(load);
	});

	// Finish restoring local documents before startup persistence is enabled.
	// Otherwise the temporary empty sessions can overwrite saved cursor state,
	// and the first visit to an inactive local tab visibly flashes a loading editor.
	// Remote and plugin tabs must not block the plugin startup they depend on.
	await Promise.all(localLoads);
}
