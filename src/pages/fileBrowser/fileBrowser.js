import "./fileBrowser.scss";

import fsOperation from "fileSystem";
import externalFs from "fileSystem/externalFs";
import Checkbox from "components/checkbox";
import Contextmenu from "components/contextmenu";
import Page from "components/page";
import searchBar from "components/searchbar";
import { loadTerminalManager } from "components/terminal/loader";
import alert from "dialogs/alert";
import confirm from "dialogs/confirm";
import loader from "dialogs/loader";
import prompt from "dialogs/prompt";
import select from "dialogs/select";
import JSZip from "jszip";
import actionStack from "lib/actionStack";
import checkFiles from "lib/checkFiles";
import config from "lib/config";
import openFolder from "lib/openFolder";
import platform from "lib/platform";
import projects from "lib/projects";
import recents from "lib/recents";
import remoteStorage from "lib/remoteStorage";
import appSettings from "lib/settings";
import { deleteSftpProfile, getSftpProfileId } from "lib/sftpProfiles";
import mustache from "mustache";
import filesSettings from "settings/filesSettings";
import URLParse from "url-parse";
import copyEntry from "utils/copyEntry";
import haptic from "utils/haptic";
import helpers from "utils/helpers";
import loadMimeTypes from "utils/mimeTypes";
import Url from "utils/Url";
import _addMenu from "./add-menu.hbs";
import _addMenuHome from "./add-menu-home.hbs";
import _template from "./fileBrowser.hbs";
import _list from "./list.hbs";
import util from "./util";

/**
 * @typedef {{url: String, name: String}} Location
 */

/**
 * @typedef Storage
 * @property {String} name
 * @property {String} uuid
 * @property {String} url
 * @property {'dir'} type
 * @property {'permission'|'ftp'|'sftp'|'sd'} storageType
 */

/**
 *
 * @param {import('.').BrowseMode} [mode='file']
 * @param {string} [info]
 * @param {boolean} [doesOpenLast]
 * @returns {Promise<import('.').SelectedFile>}
 */
function FileBrowserInclude(mode, info, doesOpenLast = true) {
	mode = mode || "file";

	const IS_FOLDER_MODE = ["folder", "both"].includes(mode);
	const IS_FILE_MODE = ["file", "both"].includes(mode);
	const SELECT_DOCUMENT_LABEL = "Select document";
	const storedState = helpers.parseJSON(localStorage.fileBrowserState) || [];
	/**@type {Array<Location>} */
	const state = [];
	/**@type {Array<Storage>} */
	const allStorages = [];
	let storageList = helpers.parseJSON(localStorage.storageList);
	if (!Array.isArray(storageList)) storageList = [];

	let isSelectionMode = false;
	let isPasting = false;
	let selectedItems = new Set();
	let copiedItems = [];
	let longPress = null;
	let suppressClick = null;
	let suppressContextMenuUntil = 0;
	let bypassSelectionForContextMenu = false;
	let $selectAllCheckbox = null;

	// In "both" mode the page title already says "File browser", so the
	// info row is only shown when the caller passes its own note.
	if (!info && mode !== "both") {
		info = IS_FOLDER_MODE ? strings["open folder"] : strings["open file"];
	}

	return new Promise((resolve, reject) => {
		//#region Declaration
		const $menuToggler = (
			<span className="icon more_vert" data-action="toggle-menu"></span>
		);
		const $addMenuToggler = (
			<span className="icon add" data-action="toggle-add-menu"></span>
		);
		const $search = <span className="icon search" data-action="search"></span>;
		const $lead = <span className="icon clearclose" data-action="close"></span>;
		const $page = Page(strings["file browser"].capitalize(), {
			lead: $lead,
		});
		let hideSearchBar = () => {};
		const $content = helpers.parseHTML(
			mustache.render(_template, {
				type: mode,
				info,
			}),
		);
		const $navigation = $content.get(".navigation");
		const menuOption = {
			top: "8px",
			right: "8px",
			toggler: $menuToggler,
			transformOrigin: "top right",
		};
		const $fbMenu = Contextmenu({
			innerHTML: () => {
				if (isSelectionMode) {
					const actions =
						currentDir.url === "/"
							? menuRow("delete", "remove", strings.remove)
							: `${menuRow("copy", "copy", strings.copy)}
        ${menuRow("zip", "compress", strings.compress)}
        ${menuRow("delete", "delete", strings.delete)}`;
					return `
        ${actions}
        ${selectedItems.size === 1 ? menuRow("more_vert", "options", strings.options || "Options") : ""}`;
				}
				return `
        ${IS_FILE_MODE ? menuRow("folder_open", "select-document", SELECT_DOCUMENT_LABEL) : ""}
        ${menuRow("text_format", "select-items", strings["select items"] || "Select items")}
        ${
					copiedItems.length && currentDir.url !== "/" && !isPasting
						? menuRow("paste", "paste", strings.paste)
						: ""
				}
        ${menuRow("settings", "settings", strings.settings)}
        ${currentDir.url === "/" ? menuRow("refresh", "refresh", strings["reset connections"]) : ""}
        ${menuRow("autorenew", "reload", strings.reload)}`;
			},
			...menuOption,
		});
		const $addMenu = Contextmenu({
			innerHTML: () => {
				if (currentDir.url === "/") {
					return mustache.render(_addMenuHome, {
						...strings,
					});
				} else {
					return mustache.render(_addMenu, strings);
				}
			},
			...((menuOption.toggler = $addMenuToggler) && menuOption),
		});

		const progress = {};
		let cachedDir = new Map();
		let currentDir = {
			url: null,
			name: null,
			list: [],
			scroll: 0,
		};
		/**
		 * @type {HTMLButtonElement}
		 */
		let $openFolder;
		//#endregion

		actionStack.setMark();
		$lead.onclick = () => {
			if (isSelectionMode) {
				isSelectionMode = false;
				toggleSelectionMode(false);
				return;
			}
			close();
		};
		$content.addEventListener("click", handleClick);
		$content.addEventListener("contextmenu", handleContextMenu, true);
		const disposeTileLongPress = installTileLongPress();
		$page.body = $content;
		$page.header.append($search, $addMenuToggler, $menuToggler);

		const $headerTitle = $page.header.get(".text");
		$selectAllCheckbox = Checkbox("", false);
		const $selectionCount = tag("span", {
			className: "text selection-count",
		});
		const $selectionStatus = (
			<div className="selection-status">
				{$selectAllCheckbox}
				{$selectionCount}
			</div>
		);
		$selectionStatus.style.display = "none";
		$page.header.insertBefore($selectionStatus, $headerTitle);
		$selectAllCheckbox.setAttribute("data-action", "select-all");
		$selectAllCheckbox.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			const checked = !$selectAllCheckbox.checked;
			$selectAllCheckbox.checked = checked;
			setAllSelected(checked);
		});
		updateSelectionCount();

		if (IS_FOLDER_MODE) {
			$openFolder = tag("button", {
				className: "floating icon check",
				title: strings["select folder"],
				ariaLabel: strings["select folder"],
				style: {
					bottom: "10px",
					top: "auto",
				},
				disabled: true,
				onclick() {
					$page.hide();

					resolve({
						type: "folder",
						...currentDir,
					});
				},
			});

			$page.append($openFolder);
		}

		app.append($page);
		helpers.showAd();

		actionStack.push({
			id: "filebrowser",
			action: close,
		});

		$fbMenu.onclick = handleMenuClick;

		$addMenu.onclick = async (e) => {
			$addMenu.hide();
			const $target = e.target;
			const action = $target.getAttribute("action");
			const value = $target.getAttribute("value");
			if (!action) return;

			switch (action) {
				case "create": {
					try {
						const newUrl = await create(value);
						if (!newUrl) break;

						const type = value === "file" ? "file" : "folder";
						openFolder.add(newUrl, type);
						reload();
					} catch (error) {
						window.log("error", error);
						helpers.error(error);
					}
					break;
				}

				case "import-project-zip": {
					let zipFile = await new Promise((resolve, reject) => {
						sdcard.openDocumentFile(
							(res) => {
								resolve(res.uri);
							},
							(err) => {
								if (helpers.isCancelled(err)) resolve(null);
								else reject(err);
							},
							"application/zip",
						);
					});

					if (!zipFile) break;

					let isCancelled = false;
					const loadingLoader = loader.create(
						strings["loading"],
						"Importing zip file...",
						{
							timeout: 10000,
							oncancel: () => {
								isCancelled = true;
							},
						},
					);

					let zipName = Url.basename(zipFile).replace(/\.zip$/, "");
					const targetDir = currentDir.url;
					let extractDir = Url.join(targetDir, zipName);

					try {
						const zipContent = await fsOperation(zipFile).readFile();
						const zip = await JSZip.loadAsync(zipContent);

						const targetFs = fsOperation(targetDir);
						if (await fsOperation(extractDir).exists()) {
							zipName = `${zipName}_${helpers.uuid()}`;
							extractDir = Url.join(targetDir, zipName);
						}
						await targetFs.createDirectory(zipName);

						const files = Object.keys(zip.files);
						const total = files.length;
						let current = 0;

						// Internal helper to recursively construct folders or empty files
						const createFileRecursive = async (
							parent,
							dir,
							shouldBeDirAtEnd,
						) => {
							if (isCancelled) {
								throw new Error("Cancelled");
							}
							let wantDirEnd = !!shouldBeDirAtEnd;
							let parts;
							if (typeof dir === "string") {
								if (dir.endsWith("/")) wantDirEnd = true;
								dir = dir.replace(/\\/g, "/");
								parts = dir.split("/");
							} else {
								parts = dir;
							}
							parts = parts.filter((d) => d);
							const cd = parts.shift();
							if (!cd) return;
							const newParent = Url.join(parent, cd);

							const isLast = parts.length === 0;
							const needDir = !isLast || wantDirEnd;
							if (!(await fsOperation(newParent).exists())) {
								if (needDir) {
									try {
										await fsOperation(parent).createDirectory(cd);
									} catch (e) {
										if (!(await fsOperation(newParent).exists())) throw e;
									}
								} else {
									try {
										await fsOperation(parent).createFile(cd);
									} catch (e) {
										if (!(await fsOperation(newParent).exists())) throw e;
									}
								}
							}
							if (parts.length) {
								await createFileRecursive(newParent, parts, wantDirEnd);
							}
						};

						const sanitizeZipPath = (p, isDir) => {
							if (!p) return "";
							let path = String(p);
							path = path.replace(/\\/g, "/");
							path = path.replace(/^[a-zA-Z]+:\/\//, "");
							path = path.replace(/^\/+/, "");
							path = path.replace(/^[A-Za-z]:\//, "");

							const parts = path.split("/");
							const stack = [];
							for (const part of parts) {
								if (!part || part === ".") continue;
								if (part === "..") {
									if (stack.length) stack.pop();
									continue;
								}
								stack.push(part);
							}
							let safe = stack.join("/");
							if (isDir && safe && !safe.endsWith("/")) safe += "/";
							return safe;
						};

						const isUnsafeAbsolutePath = (p) => {
							if (!p) return false;
							const s = String(p);
							if (/^[A-Za-z]:[\\\/]/.test(s)) return true;
							if (s.startsWith("//")) return true;
							if (s.startsWith("/")) return true;
							return false;
						};

						for (const filePath of files) {
							if (isCancelled) {
								throw new Error("Cancelled");
							}

							const entry = zip.files[filePath];
							current++;

							loadingLoader.setMessage(
								`Extracting ${filePath} (${Math.round((current / total) * 100)}%)`,
							);

							let correctFile = filePath.replace(/\\/g, "/");
							const isDirEntry = entry.dir || correctFile.endsWith("/");

							if (isUnsafeAbsolutePath(filePath)) {
								continue;
							}

							correctFile = sanitizeZipPath(correctFile, isDirEntry);
							if (!correctFile) continue;

							const fileUrl = Url.join(extractDir, correctFile);

							if (isDirEntry) {
								await createFileRecursive(extractDir, correctFile, true);
								continue;
							}

							const lastSlash = correctFile.lastIndexOf("/");
							if (lastSlash !== -1) {
								const parentRel = correctFile.slice(0, lastSlash + 1);
								await createFileRecursive(extractDir, parentRel, true);
							}

							await createFileRecursive(extractDir, correctFile, false);

							if (isCancelled) {
								throw new Error("Cancelled");
							}
							const content = await entry.async("arraybuffer");
							if (isCancelled) {
								throw new Error("Cancelled");
							}
							await fsOperation(fileUrl).writeFile(content);
						}

						if (isCancelled) {
							throw new Error("Cancelled");
						}

						loadingLoader.destroy();
						toast(strings.success);
						reload();
					} catch (err) {
						loadingLoader.destroy();
						if (err && err.message === "Cancelled") {
							try {
								await fsOperation(extractDir).delete();
							} catch (deleteErr) {
								console.error("Cleanup failed:", deleteErr);
							}
						} else {
							helpers.error(err);
						}
					}
					break;
				}

				case "add-path":
					addStorage();
					break;

				case "addFtp":
				case "addSftp": {
					const storage = await remoteStorage[action]();
					if (!storage) break;
					updateStorage(storage);
					break;
				}

				default:
					break;
			}
		};

		async function handleMenuClick(e) {
			const $target = e.target;
			$fbMenu.hide();
			const $item = $target.closest?.("li[action]");
			const action = $item?.getAttribute("action");
			if (!action) return;

			switch (action) {
				case "settings": {
					filesSettings().show();
					const onshow = () => {
						$page.off("show", onshow);
						reload();
					};
					$page.on("show", onshow);
					break;
				}

				case "reload":
					reload();
					break;

				case "refresh":
					ftp.disconnect(
						() => {},
						() => {},
					);
					sftp.close(
						() => {},
						() => {},
					);
					toast(strings.success);
					break;

				case "select-items":
					isSelectionMode = true;
					toggleSelectionMode(true);
					break;

				case "paste":
					pasteCopiedItems();
					break;

				case "select-document":
					selectDocument();
					break;

				case "options":
					showOptionsForSelection();
					break;

				case "remove": {
					const removable = [...selectedItems]
						.map((url) => {
							const $tile = [...$content.querySelectorAll("#list .tile")].find(
								($item) => $item.querySelector("data-url")?.textContent === url,
							);
							const uuid = $tile?.dataset.uuid;
							return (
								storageList.find((storage) => storage.uuid === uuid) ||
								storageList.find(
									(storage) => (storage.url || storage.uri) === url,
								)
							);
						})
						.filter(Boolean);
					if (!removable.length) break;

					const message =
						removable.length === 1
							? strings["remove entry"].replace("{name}", removable[0].name)
							: (
									strings["remove entries"] ||
									"Are you sure you want to remove {count} saved paths?"
								).replace("{count}", removable.length);

					const confirmation = await confirm(strings.warning, message);
					if (!confirmation) break;

					isSelectionMode = false;
					toggleSelectionMode(false);
					for (const storage of removable) {
						await removeStorage(
							storage.uuid,
							storage.url || storage.uri,
							false,
						);
					}
					reload();
					break;
				}

				case "copy":
					if (currentDir.url === "/" || !selectedItems.size) {
						break;
					}

					copiedItems = Array.from(selectedItems);
					toast(strings.success);
					isSelectionMode = false;
					toggleSelectionMode(false);
					break;

				case "compress":
					if (currentDir.url === "/") {
						break;
					}

					const zip = new JSZip();
					let loadingLoader = loader.create(
						strings["loading"],
						"Compressing files",
						{
							timeout: 3000,
						},
					);
					try {
						for (const url of selectedItems) {
							const fs = fsOperation(url);
							const stats = await fs.stat();
							const isDir = stats.isDirectory;

							if (isDir) {
								const addDirToZip = async (dirUrl, zipFolder) => {
									const entries = await fsOperation(dirUrl).lsDir();
									for (const entry of entries) {
										const percent = (
											((entries.length - entries.indexOf(entry)) /
												entries.length) *
											100
										).toFixed(0);
										loadingLoader.setMessage(
											`Compressing ${entry.name.length > 20 ? entry.name.substring(0, 20) + "..." : entry.name} (${percent}%)`,
										);
										if (entry.isDirectory) {
											const newZipFolder = zipFolder.folder(entry.name);
											await addDirToZip(entry.url, newZipFolder);
										} else {
											const content = await fsOperation(entry.url).readFile();
											zipFolder.file(entry.name, content, { binary: true });
										}
									}
								};
								await addDirToZip(url, zip.folder(Url.basename(url)));
							} else {
								const content = await fs.readFile();
								zip.file(Url.basename(url), content);
							}
						}

						const zipContent = await zip.generateAsync({
							type: "arraybuffer",
						});
						const zipName = "archive_" + Date.now() + ".zip";
						const zipPath = Url.join(currentDir.url, zipName);
						const shortPath =
							currentDir.url.length > 40
								? currentDir.url.substring(0, 37) + "..."
								: currentDir.url;
						loadingLoader.setMessage(`Saving ${zipName} to ${shortPath}`);
						await fsOperation(currentDir.url).createFile(zipName, zipContent);
						loadingLoader.destroy();
						toast(strings.success);
						isSelectionMode = !isSelectionMode;
						toggleSelectionMode(isSelectionMode);
						reload();
					} catch (err) {
						loadingLoader.destroy();
						toast(strings.error);
						console.error(err);
					}
					break;

				case "delete": {
					if (currentDir.url === "/") {
						break;
					}

					// Show confirmation dialog
					const confirmMessage =
						selectedItems.size === 1
							? strings["delete entry"].replace(
									"{name}",
									Array.from(selectedItems)[0].split("/").pop(),
								)
							: strings["delete entries"].replace(
									"{count}",
									selectedItems.size,
								);

					const confirmation = await confirm(strings.warning, confirmMessage);
					if (!confirmation) break;

					const loadingDialog = loader.create(
						strings.loading,
						strings["deleting items"].replace("{count}", selectedItems.size),
						{ timeout: 3000 },
					);

					try {
						for (const url of selectedItems) await deleteDirOrFile(url);
						toast(strings.success);
						reload();
						isSelectionMode = false;
						toggleSelectionMode(false);
					} catch (err) {
						loadingDialog.destroy();
						helpers.error(err);
					} finally {
						loadingDialog.destroy();
					}
					break;
				}

				default:
					break;
			}
		}

		$search.onclick = function () {
			const $list = $content.get("#list");
			if ($list) searchBar($list, (hide) => (hideSearchBar = hide));
		};

		$page.onhide = function () {
			hideSearchBar();
			actionStack.clearFromMark();
			actionStack.remove("filebrowser");
			$content.removeEventListener("click", handleClick);
			$content.removeEventListener("contextmenu", handleContextMenu);
			disposeTileLongPress();
			document.removeEventListener("resume", reload);
		};

		if (doesOpenLast && storedState.length) {
			loadStates(storedState);
			return;
		}
		navigate("/", "/");

		function close() {
			const err = new Error("User cancelled");
			Object.defineProperty(err, "code", {
				value: 0,
			});
			reject(err);
			$page.hide();
		}

		function selectDocument() {
			checkFiles.check = false;
			sdcard.openDocumentFile(
				(res) => {
					res.url = res.uri;
					resolve({
						type: "file",
						...res,
						name: res.filename,
						mode: "single",
					});
					$page.hide();
				},
				(err) => {
					if (helpers.isCancelled(err)) return;
					helpers.error(err);
				},
			);
		}

		/**
		 * @param {string} url
		 */
		function isTermuxUrl(url) {
			url = `${url ?? ""}`;
			return url.startsWith("content://com.termux.documents/tree/");
		}

		/**
		 * @param {string} url
		 * @param {string} [type]
		 */
		async function deleteDirOrFile(url, type) {
			const fs = fsOperation(url);
			const isDir = type ? helpers.isDir(type) : (await fs.stat()).isDirectory;

			if (isDir && isTermuxUrl(url)) {
				const deleteRecursively = async (currentFs) => {
					const entries = await currentFs.lsDir();
					if (entries) {
						for (const entry of entries) {
							const fs = fsOperation(entry.url);
							await (entry.isDirectory ? deleteRecursively(fs) : fs.delete());
						}
					}
					await currentFs.delete();
				};
				await deleteRecursively(fs);
			} else {
				await fs.delete();
			}

			if (isDir) {
				helpers.updateUriOfAllActiveFiles(url);
				recents.removeFolder(url);
			} else {
				const openedFile = editorManager.getFile(url, "uri");
				if (openedFile) openedFile.uri = null;
			}
			recents.removeFile(url);
			openFolder.removeItem(url);
			cachedDir.delete(url);
		}

		function updateSelectionCount() {
			if (!$selectionCount) return;
			const count = selectedItems.size;
			$selectionCount.textContent = `${count} ${count === 1 ? "item" : "items"} selected`;
		}

		function hapticFeedback() {
			if (appSettings.value.vibrateOnTap) haptic(config.VIBRATION_TIME);
		}

		async function removeStorage(uuid, url, reloadPage = true) {
			const removedStorage = storageList.find(
				(storage) => storage.uuid === uuid,
			);
			const storageUrl = removedStorage?.url || url;

			if (storageUrl) {
				recents.removeFolder(storageUrl);
				recents.removeFile(storageUrl);
				openFolder.removeFolders(storageUrl);
				helpers.updateUriOfAllActiveFiles(storageUrl, null);
			}
			if (
				storageUrl &&
				removedStorage &&
				(removedStorage.storageType === "sftp" ||
					removedStorage.type === "sftp")
			) {
				const profileId = getSftpProfileId(storageUrl);
				const { username, hostname, port = 22 } = Url.decodeUrl(storageUrl);
				const connectionID = profileId || `${username}@${hostname}:${port}`;
				await new Promise((resolve) => {
					sftp.isConnected((activeConnectionID) => {
						if (activeConnectionID !== connectionID) {
							resolve();
							return;
						}
						sftp.close(resolve, resolve);
					}, resolve);
				});
				const profileStillUsed = storageList.some(
					(storage) =>
						storage.uuid !== uuid &&
						getSftpProfileId(storage.url) === profileId,
				);
				if (profileId && !profileStillUsed) {
					await deleteSftpProfile(profileId);
				}
			}
			storageList = storageList.filter((storage) => {
				if (storage.uuid !== uuid) {
					return true;
				}

				if (storage.url && !getSftpProfileId(storage.url)) {
					const parsedUrl = URLParse(storage.url, true);
					const keyFile = decodeURIComponent(parsedUrl.query["keyFile"] || "");
					if (keyFile) fsOperation(keyFile).delete().catch(console.warn);
				}
				return false;
			});
			localStorage.storageList = JSON.stringify(storageList);
			acode.exec("save-state");
			if (reloadPage) reload();
		}

		function menuRow(icon, action, label) {
			const text = `${label || ""}`.trim().capitalize(0);
			return `<li action="${action}"><span class="text">${text}</span><span class="icon ${icon}"></span></li>`;
		}

		function setAllSelected(checked) {
			const $list = $content.get("#list");
			if (!$list) return;
			$list.querySelectorAll(".tile").forEach(($item) => {
				if (
					$item.dataset.notSelectable != null ||
					$item.dataset.notRemovable != null
				)
					return;
				const $checkbox = $item.querySelector(".input-checkbox");
				if (!$checkbox) return;
				$checkbox.checked = checked;
				const url = $item.querySelector("data-url")?.textContent;
				if (!url) return;
				if (checked) selectedItems.add(url);
				else selectedItems.delete(url);
			});
			hapticFeedback();
			updateSelectionCount();
			syncSelectAllCheckbox();
		}

		function syncSelectAllCheckbox() {
			if (!isSelectionMode) return;
			if (selectedItems.size === 0) {
				isSelectionMode = false;
				toggleSelectionMode(false);
				return;
			}
			if ($selectAllCheckbox) $selectAllCheckbox.checked = isAllSelected();
		}

		function isAllSelected() {
			const $list = $content.get("#list");
			if (!$list) return false;
			const selectable = [...$list.querySelectorAll(".tile")].filter(
				($item) =>
					$item.dataset.notSelectable == null &&
					$item.dataset.notRemovable == null &&
					$item.querySelector(".input-checkbox"),
			);
			if (!selectable.length) return false;
			return selectable.every(($item) => {
				const url = $item.querySelector("data-url")?.textContent;
				return url && selectedItems.has(url);
			});
		}

		function beginSelectionFromTile($tile) {
			if (
				$tile.dataset.notSelectable != null ||
				$tile.dataset.notRemovable != null
			)
				return false;
			const url = $tile.querySelector("data-url")?.textContent;
			if (!url) return false;
			if (!isSelectionMode) {
				isSelectionMode = true;
				toggleSelectionMode(true);
			}
			const $checkbox = $tile.querySelector(".input-checkbox");
			if ($checkbox) $checkbox.checked = true;
			selectedItems.add(url);
			hapticFeedback();
			updateSelectionCount();
			syncSelectAllCheckbox();
			return true;
		}

		function showOptionsForSelection() {
			if (selectedItems.size !== 1) return;
			const [url] = selectedItems;
			const $tile = [...$content.querySelectorAll("#list .tile")].find(
				($item) => $item.querySelector("data-url")?.textContent === url,
			);
			if (!$tile) return;
			suppressClick = null;
			suppressContextMenuUntil = 0;
			bypassSelectionForContextMenu = true;
			$tile.dispatchEvent(
				new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
			);
			bypassSelectionForContextMenu = false;
		}

		function installTileLongPress() {
			const slop = 10;

			const onPointerDown = (e) => {
				if (e.pointerType === "mouse") return;
				const $tile = e.target.closest?.("#list .tile");
				if (!$tile) return;
				if (
					$tile.hasAttribute("disabled") ||
					$tile.dataset.notSelectable != null ||
					$tile.dataset.notRemovable != null
				) {
					return;
				}
				cancelLongPress();
				longPress = {
					x: e.clientX,
					y: e.clientY,
					pointerId: e.pointerId,
					$tile,
					timer: setTimeout(() => {
						const $pressed = longPress?.$tile;
						longPress = null;
						if (!$pressed || !$pressed.isConnected) return;
						if (!beginSelectionFromTile($pressed)) return;
						suppressClick = { tile: $pressed, until: Date.now() + 700 };
						suppressContextMenuUntil = Date.now() + 700;
					}, 450),
				};
			};

			const onPointerMove = (e) => {
				if (!longPress || e.pointerId !== longPress.pointerId) return;
				if (Math.hypot(e.clientX - longPress.x, e.clientY - longPress.y) > slop)
					cancelLongPress();
			};

			const onPointerEnd = (e) => {
				if (longPress && e.pointerId !== longPress.pointerId) return;
				cancelLongPress();
			};

			$content.addEventListener("pointerdown", onPointerDown, true);
			$content.addEventListener("pointermove", onPointerMove, true);
			$content.addEventListener("pointerup", onPointerEnd, true);
			$content.addEventListener("pointercancel", onPointerEnd, true);
			$content.addEventListener("scroll", cancelLongPress, true);

			return () => {
				cancelLongPress();
				$content.removeEventListener("pointerdown", onPointerDown, true);
				$content.removeEventListener("pointermove", onPointerMove, true);
				$content.removeEventListener("pointerup", onPointerEnd, true);
				$content.removeEventListener("pointercancel", onPointerEnd, true);
				$content.removeEventListener("scroll", cancelLongPress, true);
			};
		}

		function cancelLongPress() {
			if (longPress?.timer) clearTimeout(longPress.timer);
			longPress = null;
		}

		async function pasteCopiedItems() {
			if (isPasting || !copiedItems.length || currentDir.url === "/") return;

			isPasting = true;

			const targetDirUrl = currentDir.url;
			const loadingDialog = loader.create(
				strings.loading,
				strings["copying items"]?.replace("{count}", copiedItems.length) ||
					`Copying ${copiedItems.length} items...`,
			);

			let copiedCount = 0;
			let skippedCount = 0;

			try {
				for (const url of copiedItems) {
					const fs = fsOperation(url);
					const stat = await fs.stat();
					const name = stat.name || Url.basename(url);

					const result = await copyEntry(url, targetDirUrl, {
						name,
						stat,
						excludePatterns: appSettings.value.useFileOperationExclusions
							? appSettings.value.excludeFolders
							: [],
						async onBeforeCopy() {
							if (stat.isDirectory && isInsideDirectory(url, targetDirUrl)) {
								alert(
									strings.warning,
									strings["cannot paste folder into itself"] ||
										"Cannot paste a folder into itself",
								);
								return false;
							}

							const possibleConflictUrl = Url.join(targetDirUrl, name);
							if (!(await fsOperation(possibleConflictUrl).exists())) {
								return true;
							}

							if (Url.areSame(url, possibleConflictUrl)) return false;

							const targetFs = fsOperation(possibleConflictUrl);
							const targetStat = await targetFs.stat();
							if (stat.isDirectory || targetStat.isDirectory) {
								alert(
									strings.warning,
									strings["folder already exists"] || "Folder already exists",
								);
								return false;
							}

							const confirmation = await confirm(
								strings.warning,
								strings["file already exists force named"]
									? strings["file already exists force named"].replace(
											"{name}",
											name,
										)
									: `"${name}" already exists in this location.`,
							);
							if (!confirmation) return false;

							await targetFs.delete();
							return true;
						},
					});
					if (result.url) copiedCount++;
					skippedCount += result.skipped;
				}
			} catch (err) {
				helpers.error(err);
			} finally {
				if (copiedCount) {
					toast(strings.success);
					reload();
				} else if (skippedCount) {
					toast(strings.skipped);
				}
				if (copiedCount || skippedCount) copiedItems = [];
				loadingDialog.destroy();
				isPasting = false;
			}
		}

		function isInsideDirectory(sourceUrl, targetUrl) {
			let source = Url.parse(sourceUrl).url;
			let target = Url.parse(targetUrl).url;

			if (source.endsWith("/")) source = source.slice(0, -1);
			if (target.endsWith("/")) target = target.slice(0, -1);

			return (
				source === target ||
				target.startsWith(source + "/") ||
				target.startsWith(source + "\\")
			);
		}

		function toggleSelectionMode(active) {
			const $list = $content.get("#list");
			if (active) {
				$list.classList.add("selection-mode");
				$headerTitle.style.display = "none";
				$search.style.display = "none";
				$addMenuToggler.style.display = "none";
				$selectionStatus.style.display = "";

				// Add checkboxes to list items
				$list.querySelectorAll(".tile").forEach((item) => {
					const checkbox = Checkbox("", false);
					if (
						item.dataset.notSelectable != null ||
						item.dataset.notRemovable != null
					) {
						checkbox.classList.add("disabled");
						const $input = checkbox.querySelector("input");
						if ($input) $input.disabled = true;
						item.classList.add("select-disabled");
					} else {
						checkbox.onclick = () => {
							const url = item.querySelector("data-url").textContent;
							if (checkbox.checked) {
								selectedItems.add(url);
							} else {
								selectedItems.delete(url);
							}
							updateSelectionCount();
							syncSelectAllCheckbox();
						};
					}
					item.prepend(checkbox);
				});

				$selectAllCheckbox.checked = isAllSelected();
				updateSelectionCount();

				// Disable floating button in selection mode
				if ($openFolder) {
					$openFolder.disabled = true;
				}

				if (!actionStack.has("fbSelection")) {
					actionStack.push({
						id: "fbSelection",
						action: () => {
							isSelectionMode = false;
							toggleSelectionMode(false);
						},
					});
				}
			} else {
				actionStack.remove("fbSelection");

				$list.classList.remove("selection-mode");
				$list.querySelectorAll(".input-checkbox").forEach((cb) => cb.remove());
				$list
					.querySelectorAll(".tile.select-disabled")
					.forEach((tile) => tile.classList.remove("select-disabled"));
				selectedItems.clear();

				$headerTitle.style.display = "";
				$search.style.display = "";
				$addMenuToggler.style.display = "";
				$selectionStatus.style.display = "none";
				$selectAllCheckbox.checked = false;
				updateSelectionCount();

				// Re-enable floating button when exiting selection mode
				if ($openFolder) {
					$openFolder.disabled = false;
				}
			}
		}

		/**
		 * Called when any file folder is clicked
		 * @param {MouseEvent} e
		 * @param {"contextmenu"} [isContextMenu]
		 */
		function handleClick(e, isContextMenu) {
			/**
			 * @type {HTMLElement}
			 */
			const $el = e.target;

			if (suppressClick) {
				const { tile, until } = suppressClick;
				suppressClick = null;
				if (Date.now() < until && $el.closest?.(".tile") === tile) return;
			}

			if (isSelectionMode && !bypassSelectionForContextMenu) {
				const $el2 = $el.closest(".tile");
				if (
					$el2?.dataset.notSelectable != null ||
					$el2?.dataset.notRemovable != null
				)
					return;
				const checkbox = $el2?.querySelector(".input-checkbox");
				if (checkbox) {
					checkbox.checked = !checkbox.checked;
					const url = $el2.querySelector("data-url").textContent;
					if (checkbox.checked) {
						selectedItems.add(url);
					} else {
						selectedItems.delete(url);
					}
					hapticFeedback();
					updateSelectionCount();
					syncSelectAllCheckbox();
				}
				return;
			}

			let action = $el.dataset.action;
			if (!action) return;

			let url = $el.dataset.url;
			let name = $el.dataset.name;
			const isOpenDoc = $el.dataset.openDoc != null;
			const uuid = $el.dataset.uuid;
			const type = $el.dataset.type;
			const storageType = $el.dataset.storageType;
			const home = $el.dataset.home;
			const isDir = ["dir", "directory", "folder"].includes(type);

			if (!url) {
				const $url = $el.get("data-url");
				if ($url) {
					url = $url.textContent;
				}
			}

			if (storageType === "notification") {
				switch (uuid) {
					case "addstorage":
						addStorage();
						break;

					default:
						break;
				}
				return;
			}

			if (!url && action === "open" && isDir && !isOpenDoc && !isContextMenu) {
				loader.hide();
				util.addPath(name, uuid).then((res) => {
					const storage = allStorages.find((storage) => storage.uuid === uuid);
					storage.url = res.uri;
					storage.name = res.name;
					name = res.name;
					updateStorage(storage, false);
					url = res.uri;
					folder();
				});
				return;
			}

			if (isContextMenu) action = "contextmenu";
			else if (isOpenDoc) action = "openDoc";

			switch (action) {
				case "navigation":
					folder();
					break;
				case "contextmenu":
					contextMenuHandler();
					break;
				case "open":
					if (isDir) folder();
					else if (!$el.hasAttribute("disabled")) file();
					break;
				case "openDoc":
					selectDocument();
					break;
			}

			async function folder() {
				if (home) {
					navigateToHome();
					return;
				}

				navigate(url, name);
			}

			function navigateToHome() {
				const navigationArray = [];
				const dirs = home.split("/");
				const { url: parsedUrl, query } = Url.parse(url);
				let path = "";

				for (let dir of dirs) {
					path = Url.join(path, dir);
					navigationArray.push({
						url: `${Url.join(parsedUrl, path, "")}${query}`,
						name: dir || name,
					});
				}

				loadStates(navigationArray);
			}

			function file() {
				$page.hide();
				resolve({
					type: "file",
					url,
					name,
				});
			}

			async function getShareableUri(fileUrl) {
				if (!fileUrl) return null;
				try {
					const fs = fsOperation(fileUrl);
					if (/^s?ftp:/.test(fileUrl)) {
						return fs.localName;
					}
					const stat = await fs.stat();
					return stat?.url || null;
				} catch (error) {
					return null;
				}
			}

			async function contextMenuHandler() {
				if (appSettings.value.vibrateOnTap) {
					haptic(config.VIBRATION_TIME);
				}
				if (isOpenDoc) return;

				const deleteText =
					currentDir.url === "/" ? strings.remove : strings.delete;
				const options = [
					["delete", deleteText, "delete"],
					["rename", strings.rename, "edit"],
				];

				if (/s?ftp/.test(storageType)) {
					options.push(["edit", strings.edit, "edit"]);
				}

				if (storageType === "sftp" && uuid) {
					options.push([
						"ssh_terminal",
						strings["open ssh terminal"] || "Open SSH Terminal",
						"terminal",
					]);
				}

				if (helpers.isFile(type)) {
					options.push(["info", strings.info, "info"]);
					options.push(["open_with", strings["open with"], "open_in_browser"]);
				}

				if (currentDir.url !== "/" && url) {
					options.push(["copyuri", strings["copy uri"], "copy"]);
				}

				const option = await select(strings["select"], options);
				switch (option) {
					case "delete": {
						let deleteFunction = () => removeFile();
						let message = strings["delete entry"].replace("{name}", name);
						if (uuid) {
							deleteFunction = () => removeStorage(uuid, url);
							message = strings["remove entry"].replace("{name}", name);
						}

						const confirmation = await confirm(strings.warning, message);
						if (!confirmation) break;
						await deleteFunction();
						break;
					}

					case "rename": {
						let newname = await prompt(
							strings.rename,
							name,
							helpers.isFile(type) ? "filename" : "text",
							{
								match: config.FILE_NAME_REGEX,
							},
						);

						newname = helpers.fixFilename(newname);
						if (!newname || newname === name) break;

						if (uuid) renameStorage(newname);
						else renameFile(newname);
						break;
					}

					case "edit": {
						const storage = await remoteStorage.edit(
							storageList.find((storage) => storage.uuid === uuid),
						);
						if (!storage) break;
						storage.uuid = uuid;
						updateStorage(storage);
						break;
					}

					case "ssh_terminal": {
						const TerminalManager = await loadTerminalManager();
						await TerminalManager.createRemoteTerminal({ url, name });
						$page.hide();
						break;
					}

					case "info":
						acode.exec("file-info", url);
						break;

					case "copyuri":
						if (typeof Bridge !== "undefined" && Bridge?.clipboard) {
							Bridge.clipboard.copy(url);
						} else if (navigator.clipboard?.writeText) {
							await navigator.clipboard.writeText(url);
						} else {
							alert(
								strings.error,
								strings["clipboard not available"] ||
									"Clipboard is not available.",
							);
							break;
						}
						break;

					case "open_with":
						try {
							const shareableUri = await getShareableUri(url);
							if (!shareableUri) {
								toast(strings["no app found to handle this file"]);
								break;
							}

							const mimeTypes = await loadMimeTypes();
							const mimeType =
								mimeTypes.lookup(name) ||
								mimeTypes.lookup(shareableUri) ||
								"text/plain";

							system.fileAction(shareableUri, name, "VIEW", mimeType, () => {
								toast(strings["no app found to handle this file"]);
							});
						} catch (error) {
							console.error(error);
							toast(strings.error);
						}
						break;
				}
			}

			async function renameFile(newname) {
				let newUrl;
				try {
					if (isTermuxUrl(url)) {
						if (helpers.isDir(type)) {
							alert(strings.warning, strings["rename not supported"]);
							return;
						} else {
							// Special handling for Termux content files
							const fs = fsOperation(url);
							const content = await fs.readFile();
							const dirname = Url.dirname(url);
							newUrl = Url.join(dirname, newname);
							await fsOperation(dirname).createFile(newname, content);
							await fs.delete();
						}
					} else {
						const fs = fsOperation(url);
						newUrl = await fs.renameTo(newname);
					}
					recents.removeFile(url);
					recents.addFile(newUrl);
					const file = editorManager.getFile(url, "uri");
					if (file) {
						file.uri = newUrl;
						file.filename = newname;
					}
					openFolder.renameItem(url, newUrl, newname);
					toast(strings.success);
					reload();
				} catch (err) {
					window.log("error", err);
					helpers.error(err);
				}
			}

			async function removeFile() {
				try {
					await deleteDirOrFile(url, type);
					toast(strings.success);
					reload();
				} catch (err) {
					window.log("error", err);
					helpers.error(err);
				}
			}

			function renameStorage(newname) {
				storageList = storageList.map((storage) => {
					if (storage.uuid === uuid) storage.name = newname;
					return storage;
				});
				localStorage.storageList = JSON.stringify(storageList);
				reload();
			}
		}

		function handleContextMenu(e) {
			if (
				longPress ||
				(suppressContextMenuUntil && Date.now() < suppressContextMenuUntil)
			) {
				suppressContextMenuUntil = 0;
				e.preventDefault();
				e.stopPropagation();
				return;
			}
			handleClick(e, true);
		}

		async function listAllStorages() {
			let hasInternalStorage = !!Bridge.file.externalRootDirectory;
			allStorages.length = 0;

			if (ANDROID_SDK_INT === 29) {
				const rootDirName = Bridge.file.externalRootDirectory;
				const testDirName = "Acode_Test_file" + helpers.uuid();
				const testDirFs = fsOperation(Url.join(rootDirName, testDirName));

				try {
					await fsOperation(rootDirName).createDirectory(testDirName);
					await testDirFs.createFile("test" + helpers.uuid());

					hasInternalStorage = !!(await testDirFs.lsDir()).length;
				} catch (error) {
					console.error(error);
				} finally {
					testDirFs.delete();
				}
			} else if (ANDROID_SDK_INT > 29) {
				hasInternalStorage = false;
			}

			if (hasInternalStorage) {
				util.pushFolder(
					allStorages,
					"Internal storage",
					Bridge.file.externalRootDirectory,
					{
						uuid: "internal-storage",
						notRemovable: true,
					},
				);
			}

			if (platform.localExecution) {
				try {
					const terminalPublicUrl = Bridge.file.dataDirectory + "public";
					const exists = await fsOperation(terminalPublicUrl).exists();
					if (!exists) {
						await fsOperation(Bridge.file.dataDirectory).createDirectory(
							"public",
						);
					}

					// Check if this storage is not already in the list
					const terminalPublicStorageExists = allStorages.find(
						(storage) =>
							storage.uuid === "terminal-public" ||
							storage.url === terminalPublicUrl,
					);

					if (!terminalPublicStorageExists) {
						util.pushFolder(allStorages, "Terminal Public", terminalPublicUrl, {
							uuid: "terminal-public",
							notRemovable: true,
						});
					}

					// Migrate any files left in the legacy alpine/home and
					// alpine/root directories into public/MIGRATE so they are
					// not hidden after the home/root/public merge.
					if (typeof Terminal !== "undefined" && Terminal.migrateLegacyHome) {
						Terminal.migrateLegacyHome();
					}
				} catch (err) {
					console.error("Error while adding public directory", err);
				}
			}

			try {
				const res = await externalFs.listStorages();
				res.forEach((storage) => {
					if (storageList.find((s) => s.uuid === storage.uuid)) return;
					let path;
					if (storage.path && (platform.isIOS || globalThis.isStorageManager)) {
						path = "file://" + storage.path;
					}
					util.pushFolder(allStorages, storage.name, path || "", {
						...storage,
						storageType: "sd",
						notRemovable: true,
					});
				});
			} catch (err) {
				console.warn("Unable to list external storages.", err);
			}

			storageList.forEach((storage) => {
				let url = storage.url || /**@deprecated */ storage["uri"];

				util.pushFolder(allStorages, storage.name, url, {
					storageType: storage.storageType,
					uuid: storage.uuid,
					home: storage.home,
				});
			});

			if (!allStorages.length) {
				util.pushFolder(allStorages, strings["add a storage"], "", {
					storageType: "notification",
					uuid: "addstorage",
					notSelectable: true,
				});
			}

			if (IS_FILE_MODE) {
				util.pushFolder(allStorages, SELECT_DOCUMENT_LABEL, null, {
					openDoc: true,
					notSelectable: true,
				});
			}

			return allStorages;
		}

		/**
		 * Gets directory for given url for rendering
		 * @param {String} url
		 * @param {String} name
		 * @returns {Promise<{name: String, url: String, list: [], scroll: Number}>}
		 */
		async function getDir(url, name) {
			const { fileBrowser } = appSettings.value;
			let list = [];
			let error = false;

			if (cachedDir.has(url)) {
				return cachedDir.get(url);
			} else {
				if (url === "/") {
					list = await listAllStorages();
				} else {
					const id = helpers.uuid();
					let loaderTimeout = 10000;

					if (["ftp:", "sftp:"].includes(Url.getProtocol(url))) {
						loaderTimeout = 0;
					}

					progress[id] = true;
					const timeout = setTimeout(() => {
						loader.create(name, strings.loading + "...", {
							timeout: loaderTimeout,
							oncancel() {
								navigate("/", "/");
								progress[id] = false;
							},
						});
					}, 100);

					const fs = fsOperation(url);
					try {
						list = (await fs.lsDir()) ?? [];
					} catch (err) {
						if (progress[id]) {
							helpers.error(err, url);
						} else {
							console.error(err);
						}
					}

					error = !progress[id];

					delete progress[id];
					clearTimeout(timeout);
					loader.destroy();
				}
				if (error) return null;
				return {
					url,
					name,
					scroll: 0,
					list: helpers.sortDir(list, fileBrowser, mode),
				};
			}
		}

		/**
		 * Navigates to specific directory
		 * @param {String} url
		 * @param {String} name
		 */
		async function navigate(url, name, assignBackButton = true) {
			if (document.getElementById("search-bar")) {
				hideSearchBar();
			}
			if (!url) {
				throw new Error('navigate(url, name): "url" is required.');
			}

			if (!name) {
				throw new Error('navigate(url, name): "name" is required.');
			}

			if (url === "/") {
				if (IS_FOLDER_MODE) $openFolder.disabled = true;
			} else {
				if (IS_FOLDER_MODE) $openFolder.disabled = false;
			}

			const $nav = tag.get(`#${getNavId(url)}`);

			//If navigate to previous directories, clear the rest navigation
			if ($nav) {
				let $topNav;
				while (($topNav = $navigation.lastChild) !== $nav) {
					const url = $topNav.dataset.url;
					actionStack.remove(url);
					$topNav.remove();
				}

				while (1) {
					const location = state.slice(-1)[0];
					if (!location || location.url === url) break;
					state.pop();
				}
				localStorage.fileBrowserState = JSON.stringify(state);

				const dir = await getDir(url, name);
				if (dir) {
					render(dir);
				}
				return;
			}

			const dir = await getDir(url, name);
			if (dir) {
				const { url: curl, name: cname } = currentDir;
				let action;
				if (doesOpenLast) pushState({ name, url });
				if (curl && cname && assignBackButton) {
					action = () => {
						navigate(curl, cname, false);
					};
				}
				pushToNavbar(name, url, action);
				render(dir);
			}
		}

		/**
		 * @param {"file"|"folder"|"project"} arg
		 */
		async function create(arg) {
			const { url } = currentDir;
			const alreadyCreated = [];
			const options = [];
			let ctUrl = "";
			let projectLocation = null;
			let projectFiles = "";
			let projectName = "";
			let project = "";
			let newUrl;

			if (arg === "file" || arg === "folder") {
				let title = strings["enter folder name"];
				if (arg === "file") {
					title = strings["enter file name"];
				}

				let entryName = await prompt(title, "", "filename", {
					match: config.FILE_NAME_REGEX,
					required: true,
				});

				if (!entryName) return;
				entryName = helpers.fixFilename(entryName);

				if (arg === "folder") {
					newUrl = await helpers.createFileStructure(url, entryName, false);
				}
				if (arg === "file") {
					newUrl = await helpers.createFileStructure(url, entryName);
				}
				if (!newUrl.created) return;
				return newUrl.uri;
			}

			if (arg === "project") {
				projects.list().map((project) => {
					const { name, icon } = project;
					options.push([name, name, icon]);
				});

				project = await select(strings["new project"], options);
				loader.create(project, strings.loading + "...");
				projectFiles = await projects.get(project).files();
				loader.destroy();
				projectName = await prompt(strings["project name"], project, "text", {
					required: true,
					match: config.FILE_NAME_REGEX,
				});

				if (!projectName) return;
				loader.create(projectName, strings.loading + "...");
				const fs = fsOperation(url);
				const files = Object.keys(projectFiles); // All project files

				newUrl = await fs.createDirectory(projectName);
				projectLocation = Url.join(url, projectName, "/");
				await createProject(files); // Creating project
				loader.destroy();
				return newUrl;
			}

			async function createProject(files) {
				// checking if it's the last file
				if (!files.length) {
					reload();
					return;
				}
				ctUrl = "";
				const file = files.pop();
				await createFile(file);
				return await createProject(files);
			}

			function createFile(fileUrl) {
				const paths = fileUrl.split("/");
				const filename = paths.pop();
				return createDir(projectFiles, fileUrl, filename, paths);
			}

			async function createDir(project, fileUrl, filename, paths) {
				const lclUrl = Url.join(projectLocation, ctUrl);
				const fs = fsOperation(lclUrl);

				if (paths.length === 0) {
					const data = project[fileUrl].replace(/<%name%>/g, projectName);
					await fs.createFile(filename, data);
					return;
				}

				const name = paths.splice(0, 1)[0];
				const toCreate = Url.join(lclUrl, name);
				if (!alreadyCreated.includes(toCreate)) {
					await fs.createDirectory(name);
					alreadyCreated.push(toCreate);
				}
				ctUrl += name + "/";
				return await createDir(project, fileUrl, filename, paths);
			}
		}

		/**
		 *  Pushes a navigation button to navbar
		 * @param {String} id
		 * @param {String} name
		 * @param {String} url
		 */
		function pushToNavbar(name, url, action) {
			if (!url) return;
			const displayName = name || Url.basename(url) || url;
			$navigation.append(
				<span
					id={getNavId(url)}
					className="nav"
					data-url={url}
					data-name={displayName}
					data-action="navigation"
					attr-text={displayName}
					tabIndex={-1}
				></span>,
			);
			$navigation.scrollLeft = $navigation.scrollWidth;

			if (action && !actionStack.has(url)) {
				actionStack.push({
					id: url,
					action,
				});
			}
		}

		/**
		 * Loads up given states
		 * @param {Array<Location>} states
		 */
		function loadStates(states) {
			if (!Array.isArray(states) || !states.length) return;

			const backNavigation = [];
			const lastState = states.pop();
			if (!lastState || !lastState.url) return;
			const { url } = lastState;
			const name = lastState.name || Url.basename(url) || url;
			let { url: lastUrl, name: lastName } = currentDir;

			while (states.length) {
				const location = states.splice(0, 1)[0];
				if (!location || !location.url) {
					continue;
				}
				const { url, name } = location;
				let action;

				if (doesOpenLast) pushState({ name, url });
				if (lastUrl && lastName) {
					backNavigation.push([lastUrl, lastName]);
					action = () => {
						const [url, name] = backNavigation.pop();
						navigate(url, name, false);
					};
				}
				pushToNavbar(name, url, action);
				lastUrl = url;
				lastName = name;
			}

			currentDir = { url: lastUrl, name: lastName };
			navigate(url, name);
		}

		/**
		 *
		 * @param {String} url
		 */
		function getNavId(url) {
			return `nav_${url.hashCode()}`;
		}

		/**
		 *
		 * @param {Storage} storage
		 * @param {Boolean} doesReload
		 */
		function updateStorage(storage, doesReload = true) {
			if (storage.uuid) {
				storageList = storageList.filter((s) => s.uuid !== storage.uuid);
			} else {
				storage.uuid = helpers.uuid();
			}

			if (!storage.type) {
				storage.type = "dir";
			}

			if (!storage.storageType) {
				storage.storageType = storage.type;
			}

			storageList.push(storage);
			localStorage.storageList = JSON.stringify(storageList);
			if (doesReload) reload();
		}

		function render(dir) {
			const { list, scroll } = dir;
			const $list = helpers.parseHTML(
				mustache.render(_list, {
					msg: strings["empty folder message"],
					list,
				}),
			);

			if (document.getElementById("search-bar")) {
				hideSearchBar();
			}

			const $oldList = $content.get("#list");
			if ($oldList) {
				const { url } = currentDir;
				if (url && cachedDir.has(url)) {
					cachedDir.get(url).scroll = $oldList.scrollTop;
				}
				$oldList.remove();
			}
			$content.append($list);
			$list.scrollTop = scroll;
			$list.focus();

			currentDir = dir;
			cachedDir.set(dir.url, dir);
		}

		function reload() {
			const { url, name } = currentDir;
			cachedDir.delete(url);
			navigate(url, name);
		}

		function pushState({ url, name }) {
			if (!url || !name) return;
			if (state.find((l) => l.url === url)) return;
			state.push({ url, name });
			localStorage.fileBrowserState = JSON.stringify(state);
		}

		/**
		 * Adds a new storage and refresh location
		 */
		function addStorage() {
			util
				.addPath()
				.then((res) => {
					storageList.push(res);
					localStorage.storageList = JSON.stringify(storageList);
					reload();
				})
				.catch((err) => {
					helpers.error(err);
				});
		}
	});
}

export default FileBrowserInclude;
