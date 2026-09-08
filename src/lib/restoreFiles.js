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

		if (isRemoteUri(file.uri)) {
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
	// Remote tabs keep preloading without blocking the rest of app startup.
	await Promise.all(localLoads);
}

function isRemoteUri(uri) {
	return /^(?:https?|s?ftp):/i.test(uri || "");
}
