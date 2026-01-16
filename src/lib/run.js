import fsOperation from "fileSystem";
import tutorial from "components/tutorial";
import alert from "dialogs/alert";
import box from "dialogs/box";
import markdownIt from "markdown-it";
import anchor from "markdown-it-anchor";
import MarkdownItGitHubAlerts from "markdown-it-github-alerts";
import mimeType from "mime-types";
import mustache from "mustache";
import browser from "plugins/browser";
import helpers from "utils/helpers";
import Url from "utils/Url";
import $_console from "views/console.hbs";
import $_markdown from "views/markdown.hbs";
import constants from "./constants";
import EditorFile from "./editorFile";
import openFolder from "./openFolder";
import appSettings from "./settings";

/**@type {Server} */
let webServer;

/**
 * Starts the server and run the active file in browser
 * @param {Boolean} isConsole
 * @param {"inapp"|"browser"} target
 * @param {Boolean} runFile
 */
async function run(
	isConsole = false,
	target = appSettings.value.previewMode,
	runFile = false,
) {
	if (!isConsole && !runFile) {
		const { serverPort, previewPort, previewMode, disableCache, host } =
			appSettings.value;
		if (serverPort !== previewPort) {
			const src = `http://${host}:${previewPort}`;
			if (previewMode === "browser") {
				system.openInBrowser(src);
				return;
			}

			browser.open(src);
			return;
		}
	}

	/** @type {EditorFile} */
	const activeFile = isConsole ? null : editorManager.activeFile;
	if (!isConsole && !(await activeFile?.canRun())) return;

	if (!isConsole && !localStorage.__init_runPreview) {
		localStorage.__init_runPreview = true;
		tutorial("run-preview", strings["preview info"]);
	}

	const uuid = helpers.uuid();

	let isLoading = false;
	let filename, pathName, extension;
	let port = appSettings.value.serverPort;
	let EXECUTING_SCRIPT = uuid + "_script.js";
	const MIMETYPE_HTML = mimeType.lookup("html");
	const CONSOLE_SCRIPT = uuid + "_console.js";
	const MARKDOWN_STYLE = uuid + "_md.css";
	const queue = [];

	if (activeFile) {
		filename = activeFile.filename;
		pathName = activeFile.location;
		extension = Url.extname(filename);

		if (!pathName && activeFile.uri) {
			pathName = Url.dirname(activeFile.uri);
		}
	}

	if (runFile && extension === "svg") {
		try {
			const fs = fsOperation(activeFile.uri);
			const res = await fs.readFile();
			const blob = new Blob([new Uint8Array(res)], {
				type: mimeType.lookup(extension),
			});

			box(filename, `<img src='${URL.createObjectURL(blob)}'>`);
		} catch (err) {
			helpers.error(err);
		}
		return;
	}

	if (!runFile && filename !== "index.html" && pathName) {
		const folder = openFolder.find(activeFile.uri);

		if (folder) {
			const { url } = folder;
			const fs = fsOperation(Url.join(url, "index.html"));

			try {
				if (await fs.exists()) {
					filename = "index.html";
					extension = "html";
					pathName = url;
					start();
					return;
				}

				next();
				return;
			} catch (err) {
				helpers.error(err);
				return;
			}
		}
	}

	next();

	function next() {
		if (extension === ".js" || isConsole) startConsole();
		else start();
	}

	function startConsole() {
		runConsole();
		start();
	}

	function runConsole() {
		if (!isConsole) EXECUTING_SCRIPT = activeFile.filename;
		isConsole = true;
		target = "inapp";
		filename = "console.html";
		pathName = `${ASSETS_DIRECTORY}www/`;
		port = constants.CONSOLE_PORT;
	}

	function start() {
		if (target === "browser") {
			system.isPowerSaveMode((res) => {
				if (res) {
					alert(strings.info, strings["powersave mode warning"]);
				} else {
					startServer();
				}
			}, startServer);
		} else {
			startServer();
		}
	}

	function startServer() {
		webServer?.stop();
		webServer = CreateServer(port, openBrowser, onError);
		webServer.setOnRequestHandler(handleRequest);

		function onError(err) {
			if (err === "Server already running") {
				openBrowser();
			} else {
				++port;
				start();
			}
		}
	}

	/**
	 * Requests handler
	 * @param {object} req
	 * @param {string} req.requestId
	 * @param {string} req.path
	 */
	function handleRequest(req) {
		const reqId = req.requestId;
		let reqPath = req.path.substring(1);

		if (!reqPath || reqPath.endsWith("/")) {
			reqPath += "index.html";
		}

		const ext = Url.extname(reqPath);
		let url = null;

		switch (reqPath) {
			case CONSOLE_SCRIPT:
				if (
					isConsole ||
					appSettings.value.console === appSettings.CONSOLE_LEGACY
				) {
					url = `${ASSETS_DIRECTORY}/build/console.js`;
				} else {
					url = `${DATA_STORAGE}/eruda.js`;
				}
				sendFileContent(url, reqId, "application/javascript");
				break;

			case EXECUTING_SCRIPT: {
				const text = activeFile?.session.getValue() || "";
				sendText(text, reqId, "application/javascript");
				break;
			}

			case MARKDOWN_STYLE:
				url = appSettings.value.markdownStyle;
				if (url) sendFileContent(url, reqId, "text/css");
				else sendText("img {max-width: 100%;}", reqId, "text/css");
				break;

			default:
				sendByExt();
				break;
		}

		async function sendByExt() {
			if (isConsole) {
				if (reqPath === "console.html") {
					sendText(
						mustache.render($_console, {
							CONSOLE_SCRIPT,
							EXECUTING_SCRIPT,
						}),
						reqId,
						MIMETYPE_HTML,
					);
					return;
				}

				if (reqPath === "favicon.ico") {
					sendIco(ASSETS_DIRECTORY, reqId);
					return;
				}
			}

			if (activeFile.mode === "single") {
				if (filename === reqPath) {
					sendText(
						activeFile.session.getValue(),
						reqId,
						mimeType.lookup(filename),
					);
				} else {
					error(reqId);
				}
				return;
			}

			let url = activeFile.uri;
			let file = activeFile.SAFMode === "single" ? activeFile : null;

			if (pathName) {
				url = Url.join(pathName, reqPath);
				file = editorManager.getFile(url, "uri");
			} else if (!activeFile.uri) {
				file = activeFile;
			}

			// Handle extensionless URLs (e.g., "about" -> "about.html" or "about/index.html")
			if (!ext && pathName) {
				// Try exact match first for extensionless files (LICENSE, README, etc.)
				const exactUrl = Url.join(pathName, reqPath);
				const exactFs = fsOperation(exactUrl);
				if (await exactFs.exists()) {
					sendFile(exactUrl, reqId);
					return;
				}

				// Try path.html
				const htmlUrl = Url.join(pathName, reqPath + ".html");
				const htmlFile = editorManager.getFile(htmlUrl, "uri");
				if (htmlFile?.loaded && htmlFile.isUnsaved) {
					sendHTML(htmlFile.session?.getValue(), reqId);
					return;
				}
				const htmlFs = fsOperation(htmlUrl);
				if (await htmlFs.exists()) {
					sendFileContent(htmlUrl, reqId, MIMETYPE_HTML);
					return;
				}

				// Try path/index.html
				const indexUrl = Url.join(pathName, reqPath, "index.html");
				const indexFs = fsOperation(indexUrl);
				if (await indexFs.exists()) {
					sendFileContent(indexUrl, reqId, MIMETYPE_HTML);
					return;
				}

				error(reqId);
				return;
			}

			switch (ext) {
				case ".htm":
				case ".html":
					if (file && file.loaded && file.isUnsaved) {
						sendHTML(file.session.getValue(), reqId);
					} else {
						sendFileContent(url, reqId, MIMETYPE_HTML);
					}
					break;

				case ".md":
					if (file) {
						const html = markdownIt({ html: true })
							.use(MarkdownItGitHubAlerts)
							.use(anchor, {
								slugify: (s) =>
									s
										.trim()
										.toLowerCase()
										.replace(/[^a-z0-9]+/g, "-"),
							})
							.render(file.session.getValue());
						const doc = mustache.render($_markdown, {
							html,
							filename,
							MARKDOWN_STYLE,
						});
						sendText(doc, reqId, MIMETYPE_HTML);
					}
					break;

				default:
					if (file && file.loaded && file.isUnsaved) {
						sendText(
							file.session.getValue(),
							reqId,
							mimeType.lookup(file.filename),
						);
					} else if (url) {
						if (reqPath === "favicon.ico") {
							sendIco(ASSETS_DIRECTORY, reqId);
						} else {
							sendFile(url, reqId);
						}
					} else {
						error(reqId);
					}
					break;
			}
		}
	}

	/**
	 * Sends 404 error
	 * @param {string} id
	 */
	function error(id) {
		webServer?.send(id, {
			status: 404,
			body: "File not found!",
		});
	}

	/**
	 * Sends favicon
	 * @param {string} assets
	 * @param {string} reqId
	 */
	function sendIco(assets, reqId) {
		const ico = Url.join(assets, "res/logo/favicon.ico");
		sendFile(ico, reqId);
	}

	/**
	 * Sends HTML file
	 * @param {string} text
	 * @param {string} id
	 */
	function sendHTML(text, id) {
		const js = `<!-- Injected code, this is not present in original code --><meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <script class="${uuid}" src="/${CONSOLE_SCRIPT}" crossorigin="anonymous"></script>
    <script class="${uuid}">
      if(window.eruda){
        eruda.init({
          theme: 'dark'
        });

        ${
					target === "inapp"
						? "eruda._shadowRoot.querySelector('.eruda-entry-btn').style.display = 'none';"
						: ""
				}

        sessionStorage.setItem('__console_available', true);
        document.addEventListener('showconsole', function () {eruda.show()});
        document.addEventListener('hideconsole', function () {eruda.hide()});
      }else if(document.querySelector('c-toggler')){
        ${
					target === "inapp" ||
					(target !== "inapp" && !appSettings.value.showConsoleToggler)
						? "document.querySelector('c-toggler').style.display = 'none';"
						: ""
				}
      }
      setTimeout(function(){
        var scripts = document.querySelectorAll('.${uuid}');
        scripts.forEach(function(el){document.head.removeChild(el)});
      }, 0);
    </script><!-- Injected code, this is not present in original code -->`;
		text = text.replace(/><\/script>/g, ' crossorigin="anonymous"></script>');
		const part = text.split("<head>");
		if (part.length === 2) {
			text = `${part[0]}<head>${js}${part[1]}`;
		} else if (/<html>/i.test(text)) {
			text = text.replace("<html>", `<html><head>${js}</head>`);
		} else {
			text = `<head>${js}</head>` + text;
		}
		sendText(text, id);
	}

	/**
	 * Sends file
	 * @param {string} path
	 * @param {string} id
	 * @returns
	 */
	async function sendFile(path, id) {
		if (isLoading) {
			queue.push(() => {
				sendFile(path, id);
			});
			return;
		}

		isLoading = true;
		const protocol = Url.getProtocol(path);
		const ext = Url.extname(path);
		const mimetype = mimeType.lookup(ext);
		if (/s?ftp:/.test(protocol)) {
			const cacheFile = Url.join(
				CACHE_STORAGE,
				protocol.slice(0, -1) + path.hashCode(),
			);
			const fs = fsOperation(path);
			try {
				await fs.readFile(); // Because reading the remote file will create cache file
				path = cacheFile;
			} catch (err) {
				error(id);
				isLoading = false;
				return;
			}
		} else if (protocol === "content:") {
			path = await new Promise((resolve, reject) => {
				sdcard.formatUri(path, resolve, reject);
			});
		} else if (!/^file:/.test(protocol)) {
			const fileContent = await fsOperation(path).readFile();
			const tempFileName = path.hashCode();
			const tempFile = Url.join(CACHE_STORAGE, tempFileName);
			if (!(await fsOperation(tempFile).exists())) {
				await fsOperation(CACHE_STORAGE).createFile(tempFileName, fileContent);
			} else {
				await fsOperation(tempFile).writeFile(fileContent);
			}
			path = tempFile;
		}

		webServer?.send(id, {
			status: 200,
			path,
			headers: {
				"Content-Type": mimetype,
			},
		});

		isLoading = false;
		const action = queue.splice(-1, 1)[0];
		if (typeof action === "function") action();
	}

	/**
	 * Sends file content
	 * @param {string} url
	 * @param {string} id
	 * @param {string} mime
	 * @param {(txt: string) => string} processText
	 * @returns
	 */
	async function sendFileContent(url, id, mime, processText) {
		const fs = fsOperation(url);

		if (!(await fs.exists())) {
			error(id);
			return;
		}

		let text = await fs.readFile(appSettings.value.defaultFileEncoding);
		text = processText ? processText(text) : text;
		if (mime === MIMETYPE_HTML) {
			sendHTML(text, id);
		} else {
			sendText(text, id, mime);
		}
	}

	/**
	 * Sends text
	 * @param {string} text
	 * @param {string} id
	 * @param {string} mimeType
	 * @param {(txt: string) => string} processText
	 */
	function sendText(text, id, mimeType, processText) {
		webServer?.send(id, {
			status: 200,
			body: processText ? processText(text) : text,
			headers: {
				"Content-Type": mimeType || "text/html",
			},
		});
	}

	/**
	 * Opens the preview in browser
	 */
	function openBrowser() {
		console.count("openBrowser");
		const src = `http://localhost:${port}/${filename}`;
		if (target === "browser") {
			system.openInBrowser(src);
			return;
		}

		browser.open(src, isConsole);
	}
}

export default run;
