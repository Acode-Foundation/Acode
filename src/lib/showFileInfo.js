import fsOperation from "fileSystem";
import box from "dialogs/box";
import { filesize } from "filesize";
import mustache from "mustache";
import helpers from "utils/helpers";
import Url from "utils/Url";
import $_fileInfo from "views/file-info.hbs";
import settings from "./settings";

/**
 * Shows file info
 * @param {String} [url]
 */
export default async function showFileInfo(url) {
	if (!url) url = editorManager.activeFile.uri;
	app.classList.add("title-loading");
	try {
		const fs = fsOperation(url);
		const stats = await fs.stat();

		let { name, lastModified, length, type } = stats;
		length = filesize(length);
		lastModified = new Date(lastModified).toLocaleString();

		const protocol = Url.getProtocol(url);
		const fileType = type.toLowerCase();
		const options = {
			name: name.slice(0, name.length - Url.extname(name).length),
			extension: Url.extname(name),
			lastModified,
			length,
			type,
			lang: strings,
			showUri: helpers.getVirtualPath(url),
			isEditor:
				fileType === "text/plain" || editorManager.activeFile.type === "editor",
		};

		if (editorManager.activeFile.type === "editor") {
			const value = await fs.readFile(settings.value.defaultFileEncoding);
			options.lineCount = value.split(/\n+/).length;
			options.wordCount = value.split(/\s+|\n+/).length;

			if (/s?ftp:/.test(protocol)) {
				options.shareUri = Url.join(CACHE_STORAGE, name);
				const fs = fsOperation(options.shareUri);
				if (await fs.exists()) {
					await fs.delete();
				}
				await fsOperation(CACHE_STORAGE).createFile(name, value);
			}
		}

		box("", mustache.render($_fileInfo, options), true).onclick((e) => {
			const $target = e.target;
			if ($target instanceof HTMLElement) {
				const action = $target.getAttribute("action");

				if (action === "copy") {
					cordova.plugins.clipboard.copy($target.textContent);
					toast(strings["copied to clipboard"]);
				}
			}
		});
	} catch (err) {
		helpers.error(err);
	}

	app.classList.remove("title-loading");
}
