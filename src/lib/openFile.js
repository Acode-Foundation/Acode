import fsOperation from "fileSystem";
import AudioPlayer from "components/audioPlayer";
import alert from "dialogs/alert";
import confirm from "dialogs/confirm";
import loader from "dialogs/loader";
import { reopenWithNewEncoding } from "palettes/changeEncoding";
import { decode, detectEncoding } from "utils/encodings";
import helpers from "utils/helpers";
import EditorFile from "./editorFile";
import fileTypeHandler from "./fileTypeHandler";
import recents from "./recents";
import appSettings from "./settings";

/**
 * @typedef {object} FileOptions
 * @property {string} text
 * @property {{ row: number, column: number }} cursorPos
 * @property {boolean} render
 * @property {function} onsave
 * @property {string} encoding
 * @property {string} mode
 * @property {string} uri
 */

/**
 * Opens a editor file
 * @param {String & FileOptions} file
 * @param {FileOptions} options
 */

export default async function openFile(file, options = {}) {
	try {
		let uri = typeof file === "string" ? file : file.uri;
		if (!uri) return;

		/**@type {EditorFile} */
		const existingFile = editorManager.getFile(uri, "uri");
		const { cursorPos, render, onsave, text, mode, encoding } = options;

		if (existingFile) {
			// If file is already opened and new text is provided
			const existingText = existingFile.session.getValue();
			const existingCursorPos = existingFile.session.selection.getCursor();

			// If file is already opened
			existingFile.makeActive();

			if (onsave) {
				existingFile.onsave = onsave;
			}

			if (text && existingText !== text) {
				// let confirmation = true;
				// if (existingFile.isUnsaved) {
				//   const message = strings['reopen file'].replace('{file}', existingFile.filename);
				//   confirmation = await confirm(strings.warning, message);
				// }
				// if (confirmation) {
				// }
				existingFile.session.setValue(text);
			}

			if (
				cursorPos &&
				existingCursorPos &&
				existingCursorPos.row !== cursorPos.row &&
				existingCursorPos.column !== cursorPos.column
			) {
				existingFile.session.selection.moveCursorTo(
					cursorPos.row,
					cursorPos.column,
				);
			}

			if (encoding && existingFile.encoding !== encoding) {
				reopenWithNewEncoding(encoding);
			}
			return;
		}

		loader.showTitleLoader();
		const settings = appSettings.value;
		const fs = fsOperation(uri);
		const fileInfo = await fs.stat();
		const name = fileInfo.name || file.filename || uri;
		const readOnly = fileInfo.canWrite ? false : true;
		const createEditor = (isUnsaved, text, detectedEncoding) => {
			new EditorFile(name, {
				uri,
				text,
				cursorPos,
				isUnsaved,
				render,
				onsave,
				readOnly,
				encoding: detectedEncoding || encoding,
				SAFMode: mode,
			});
		};

		// Check for registered file handlers
		const customHandler = fileTypeHandler.getFileHandler(name);
		if (customHandler) {
			try {
				await customHandler.handleFile({
					name,
					uri,
					stats: fileInfo,
					readOnly,
					options: {
						cursorPos,
						render,
						onsave,
						encoding,
						mode,
						createEditor,
					},
				});
				return;
			} catch (error) {
				console.error(`File handler '${customHandler.id}' failed:`, error);
				// Continue with default handling if custom handler fails
			}
		}

		if (text) {
			// If file is not opened and has unsaved text
			createEditor(true, text);
			return;
		}

		const videoRegex = /\.(mp4|webm|ogg|mov|avi|wmv|flv|mkv|3gp)$/i;
		const imageRegex = /\.(jpe?g|png|gif|webp|bmp|ico|avif|apng|tiff?)$/i;
		const audioRegex = /\.(mp3|wav|ogg|m4a|aac|wma|flac|opus|3gp|mid|midi)$/i;

		if (videoRegex.test(name)) {
			const objectUrl = await fileToDataUrl(uri);
			const videoContainer = (
				<div
					style={{
						width: "100%",
						height: "100%",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
					}}
				></div>
			);

			const videoEl = (
				<video
					src={objectUrl}
					controls
					style={{
						maxWidth: "100%",
						maxHeight: "100%",
					}}
				></video>
			);

			videoContainer.append(videoEl);

			new EditorFile(name, {
				uri,
				type: "video",
				tabIcon: "file file_type_video",
				content: videoContainer,
				render: true,
			});
			return;
		}

		if (imageRegex.test(name)) {
			const objectUrl = await fileToDataUrl(uri);
			const imageContainer = (
				<div
					className="image-container"
					style={{
						width: "100%",
						height: "100%",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						overflow: "hidden",
						position: "relative",
					}}
				></div>
			);

			const imgEl = (
				<img
					src={objectUrl}
					style={{
						maxWidth: "100%",
						maxHeight: "100%",
						transformOrigin: "center",
						transform: "scale(1) translate(0px, 0px)",
						transition: "none",
						cursor: "move",
					}}
				/>
			);

			let scale = 1;
			let startX = 0;
			let startY = 0;
			let translateX = 0;
			let translateY = 0;
			let lastX = 0;
			let lastY = 0;

			function getBoundaries() {
				const containerRect = imageContainer.getBoundingClientRect();
				const imgRect = imgEl.getBoundingClientRect();

				const maxX =
					(imgRect.width * scale - containerRect.width) / (2 * scale);
				const maxY =
					(imgRect.height * scale - containerRect.height) / (2 * scale);

				return {
					maxX: Math.max(0, maxX),
					maxY: Math.max(0, maxY),
					minX: -Math.max(0, maxX),
					minY: -Math.max(0, maxY),
				};
			}

			function constrainTranslation() {
				const bounds = getBoundaries();
				translateX = Math.min(Math.max(translateX, bounds.minX), bounds.maxX);
				translateY = Math.min(Math.max(translateY, bounds.minY), bounds.maxY);
			}

			// Zoom with mouse wheel
			imageContainer.addEventListener("wheel", (e) => {
				e.preventDefault();
				const delta = e.deltaY > 0 ? -0.1 : 0.1;
				const oldScale = scale;
				scale = Math.max(0.1, Math.min(5, scale + delta));

				// Adjust translation to zoom toward mouse position
				const rect = imgEl.getBoundingClientRect();
				const mouseX = e.clientX - rect.left;
				const mouseY = e.clientY - rect.top;

				const scaleChange = scale / oldScale;
				translateX = mouseX - (mouseX - translateX) * scaleChange;
				translateY = mouseY - (mouseY - translateY) * scaleChange;

				constrainTranslation();
				imgEl.style.transform = `scale(${scale}) translate(${translateX}px, ${translateY}px)`;
			});

			// Pan image with mouse drag or touch
			imageContainer.addEventListener("mousedown", startDrag);
			imageContainer.addEventListener("touchstart", (e) => {
				if (e.touches.length === 1) {
					startDrag(e.touches[0]);
				} else if (e.touches.length === 2) {
					const touch1 = e.touches[0];
					const touch2 = e.touches[1];
					startX = Math.abs(touch1.clientX - touch2.clientX);
					startY = Math.abs(touch1.clientY - touch2.clientY);
				}
			});

			function startDrag(e) {
				lastX = e.clientX;
				lastY = e.clientY;
				document.addEventListener("mousemove", onDrag);
				document.addEventListener("mouseup", stopDrag);
				document.addEventListener("touchmove", onTouchDrag);
				document.addEventListener("touchend", stopDrag);
			}

			function onDrag(e) {
				const deltaX = e.clientX - lastX;
				const deltaY = e.clientY - lastY;
				translateX += deltaX / scale;
				translateY += deltaY / scale;
				lastX = e.clientX;
				lastY = e.clientY;
				constrainTranslation();
				imgEl.style.transform = `scale(${scale}) translate(${translateX}px, ${translateY}px)`;
			}

			function onTouchDrag(e) {
				if (e.touches.length === 1) {
					const touch = e.touches[0];
					const deltaX = touch.clientX - lastX;
					const deltaY = touch.clientY - lastY;
					translateX += deltaX / scale;
					translateY += deltaY / scale;
					lastX = touch.clientX;
					lastY = touch.clientY;
					constrainTranslation();
					imgEl.style.transform = `scale(${scale}) translate(${translateX}px, ${translateY}px)`;
				} else if (e.touches.length === 2) {
					e.preventDefault();
					const touch1 = e.touches[0];
					const touch2 = e.touches[1];
					const currentX = Math.abs(touch1.clientX - touch2.clientX);
					const currentY = Math.abs(touch1.clientY - touch2.clientY);

					const startDist = Math.sqrt(startX * startX + startY * startY);
					const currentDist = Math.sqrt(
						currentX * currentX + currentY * currentY,
					);

					const delta = (currentDist - startDist) / 100;
					scale = Math.max(0.1, Math.min(5, scale + delta));
					constrainTranslation();
					imgEl.style.transform = `scale(${scale}) translate(${translateX}px, ${translateY}px)`;

					startX = currentX;
					startY = currentY;
				}
			}

			function stopDrag() {
				document.removeEventListener("mousemove", onDrag);
				document.removeEventListener("mouseup", stopDrag);
				document.removeEventListener("touchmove", onTouchDrag);
				document.removeEventListener("touchend", stopDrag);
			}

			imageContainer.append(imgEl);

			new EditorFile(name, {
				uri,
				type: "image",
				tabIcon: "file file_type_image",
				content: imageContainer,
				render: true,
			});
			return;
		}

		if (audioRegex.test(name)) {
			const objectUrl = await fileToDataUrl(uri);
			const audioContainer = (
				<div
					style={{
						width: "100%",
						height: "100%",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
					}}
				></div>
			);

			const audioPlayer = new AudioPlayer(audioContainer);
			audioPlayer.loadTrack(objectUrl);

			const audioTab = new EditorFile(name, {
				uri,
				type: "audio",
				tabIcon: "file file_type_audio",
				content: audioPlayer.container,
				render: true,
			});
			audioTab.onclose = () => {
				audioPlayer.cleanup();
			};
			return;
		}

		// Else open a new file
		// Checks for valid file
		if (fileInfo.length * 0.000001 > settings.maxFileSize) {
			return alert(
				strings.error.toUpperCase(),
				strings["file too large"].replace(
					"{size}",
					settings.maxFileSize + "MB",
				),
			);
		}

		if (helpers.isBinary(uri)) {
			const confirmation = await confirm(strings.info, strings["binary file"]);
			if (!confirmation) return;
		}

		const binData = await fs.readFile();

		// Determine encoding: if explicit provided use it, otherwise
		// if settings.defaultFileEncoding === 'auto' then detect; else use the default as-is
		let detectedEncoding = file.encoding || encoding;
		if (!detectedEncoding) {
			const defaultSetting = appSettings.value.defaultFileEncoding;
			if (defaultSetting === "auto") {
				try {
					detectedEncoding = await detectEncoding(binData);
					if (detectedEncoding === "auto") detectedEncoding = "UTF-8";
				} catch (error) {
					console.warn("Encoding detection failed, using UTF-8:", error);
					detectedEncoding = "UTF-8";
				}
			} else {
				detectedEncoding = defaultSetting || "UTF-8";
			}
		}

		const fileContent = await decode(binData, detectedEncoding);

		createEditor(false, fileContent, detectedEncoding);
		if (mode !== "single") recents.addFile(uri);
		return;
	} catch (error) {
		console.error(error);
	} finally {
		loader.removeTitleLoader();
	}
}

/**
 * Converts file to data url
 * @param {string} file file url
 */
async function fileToDataUrl(file) {
	const fs = fsOperation(file);
	const fileInfo = await fs.stat();
	const binData = await fs.readFile();
	return URL.createObjectURL(new Blob([binData], { type: fileInfo.mime }));
}
