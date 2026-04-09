import EditorFile from "./editorFile";

/**
 *
 * @param {import('./editorFile').FileOptions[]} files
 * @param {(count: number)=>void} callback
 */
export default async function restoreFiles(files) {
	let rendered = false;

	await Promise.all(
		files.map(async (file, i) => {
			rendered ||= !!file.render;

			if (i === files.length - 1 && !rendered) {
				file.render = true;
			}

			const { filename, render = false } = file;
			const options = {
				...file,
				render,
				emitUpdate: false,
			};
			new EditorFile(filename, options);
		}),
	);
}
