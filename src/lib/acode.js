import fsOperation from "fileSystem";
import sidebarApps from "sidebarApps";
import ajax from "@deadlyjack/ajax";
import { addMode, removeMode } from "ace/modelist";
import Contextmenu from "components/contextmenu";
import inputhints from "components/inputhints";
import Page from "components/page";
import palette from "components/palette";
import settingsPage from "components/settingsPage";
import SideButton from "components/sideButton";
import { TerminalManager, TerminalThemeManager } from "components/terminal";
import toast from "components/toast";
import tutorial from "components/tutorial";
import alert from "dialogs/alert";
import box from "dialogs/box";
import colorPicker from "dialogs/color";
import confirm from "dialogs/confirm";
import loader from "dialogs/loader";
import multiPrompt from "dialogs/multiPrompt";
import prompt from "dialogs/prompt";
import select from "dialogs/select";
import { addIntentHandler, removeIntentHandler } from "handlers/intent";
import keyboardHandler from "handlers/keyboard";
import purchaseListener from "handlers/purchase";
import windowResize from "handlers/windowResize";
import actionStack from "lib/actionStack";
import commands from "lib/commands";
import EditorFile from "lib/editorFile";
import files from "lib/fileList";
import fileTypeHandler from "lib/fileTypeHandler";
import fonts from "lib/fonts";
import NotificationManager from "lib/notificationManager";
import openFolder, { addedFolder } from "lib/openFolder";
import projects from "lib/projects";
import selectionMenu from "lib/selectionMenu";
import appSettings from "lib/settings";
import FileBrowser from "pages/fileBrowser";
import formatterSettings from "settings/formatterSettings";
import ThemeBuilder from "theme/builder";
import themes from "theme/list";
import Color from "utils/color";
import encodings, { decode, encode } from "utils/encodings";
import helpers from "utils/helpers";
import KeyboardEvent from "utils/keyboardEvent";
import Url from "utils/Url";
import constants from "./constants";

export default class Acode {
	#modules = {};
	#pluginsInit = {};
	#pluginUnmount = {};
	#formatter = [
		{
			id: "default",
			name: "Default",
			exts: ["*"],
			format: async () => {
				const { beautify } = ace.require("ace/ext/beautify");
				const cursorPos = editorManager.editor.getCursorPosition();
				beautify(editorManager.editor.session);
				editorManager.editor.gotoLine(cursorPos.row + 1, cursorPos.column);
			},
		},
	];

	constructor() {
		const encodingsModule = {
			get encodings() {
				return encodings;
			},
			encode,
			decode,
		};

		const themesModule = {
			add: themes.add,
			get: themes.get,
			list: themes.list,
			update: themes.update,
			// Deprecated, not supported anymore
			apply: () => {},
		};

		const sidebarAppsModule = {
			add: sidebarApps.add,
			get: sidebarApps.get,
			remove: sidebarApps.remove,
		};

		const aceModes = {
			addMode,
			removeMode,
		};

		const intent = {
			addHandler: addIntentHandler,
			removeHandler: removeIntentHandler,
		};

		const terminalModule = {
			create: (options) => TerminalManager.createTerminal(options),
			createLocal: (options) => TerminalManager.createLocalTerminal(options),
			createServer: (options) => TerminalManager.createServerTerminal(options),
			get: (id) => TerminalManager.getTerminal(id),
			getAll: () => TerminalManager.getAllTerminals(),
			write: (id, data) => this.#secureTerminalWrite(id, data),
			clear: (id) => TerminalManager.clearTerminal(id),
			close: (id) => TerminalManager.closeTerminal(id),
			themes: {
				register: (name, theme, pluginId) =>
					TerminalThemeManager.registerTheme(name, theme, pluginId),
				unregister: (name, pluginId) =>
					TerminalThemeManager.unregisterTheme(name, pluginId),
				get: (name) => TerminalThemeManager.getTheme(name),
				getAll: () => TerminalThemeManager.getAllThemes(),
				getNames: () => TerminalThemeManager.getThemeNames(),
				createVariant: (baseName, overrides) =>
					TerminalThemeManager.createVariant(baseName, overrides),
			},
		};

		this.define("Url", Url);
		this.define("page", Page);
		this.define("Color", Color);
		this.define("fonts", fonts);
		this.define("toast", toast);
		this.define("alert", alert);
		this.define("select", select);
		this.define("loader", loader);
		this.define("dialogBox", box);
		this.define("prompt", prompt);
		this.define("intent", intent);
		this.define("fileList", files);
		this.define("fs", fsOperation);
		this.define("confirm", confirm);
		this.define("helpers", helpers);
		this.define("palette", palette);
		this.define("projects", projects);
		this.define("tutorial", tutorial);
		this.define("aceModes", aceModes);
		this.define("themes", themesModule);
		this.define("settings", appSettings);
		this.define("sideButton", SideButton);
		this.define("EditorFile", EditorFile);
		this.define("inputhints", inputhints);
		this.define("openfolder", openFolder);
		this.define("colorPicker", colorPicker);
		this.define("actionStack", actionStack);
		this.define("multiPrompt", multiPrompt);
		this.define("addedfolder", addedFolder);
		this.define("contextMenu", Contextmenu);
		this.define("fileBrowser", FileBrowser);
		this.define("fsOperation", fsOperation);
		this.define("keyboard", keyboardHandler);
		this.define("windowResize", windowResize);
		this.define("encodings", encodingsModule);
		this.define("themeBuilder", ThemeBuilder);
		this.define("selectionMenu", selectionMenu);
		this.define("sidebarApps", sidebarAppsModule);
		this.define("terminal", terminalModule);
		this.define("createKeyboardEvent", KeyboardEvent);
		this.define("toInternalUrl", helpers.toInternalUri);
	}

	/**
	 * Secure terminal write with command validation
	 * Prevents execution of malicious or dangerous commands through plugin API
	 * @param {string} id - Terminal ID
	 * @param {string} data - Data to write
	 */
	#secureTerminalWrite(id, data) {
		if (typeof data !== "string") {
			console.warn("Terminal write data must be a string");
			return;
		}

		// List of potentially dangerous commands/patterns to block
		const dangerousPatterns = [
			// System commands that can cause damage
			/^\s*rm\s+-rf?\s+\/[^\r\n]*[\r\n]?$/m,
			/^\s*rm\s+-rf?\s+\*[^\r\n]*[\r\n]?$/m,
			/^\s*rm\s+-rf?\s+~[^\r\n]*[\r\n]?$/m,
			/^\s*mkfs\.[^\r\n]*[\r\n]?$/m,
			/^\s*dd\s+if=\/[^\r\n]*[\r\n]?$/m,
			/^\s*:(){ :|:& };:[^\r\n]*[\r\n]?$/m, // Fork bomb
			/^\s*sudo\s+dd\s+if=\/[^\r\n]*[\r\n]?$/m,
			/^\s*sudo\s+rm\s+-rf?\s+\/[^\r\n]*[\r\n]?$/m,
			/^\s*curl\s+[^\r\n]*\|\s*sh[^\r\n]*[\r\n]?$/m,
			/^\s*wget\s+[^\r\n]*\|\s*sh[^\r\n]*[\r\n]?$/m,
			/^\s*bash\s+<\s*\([^\r\n]*[\r\n]?$/m,
			/^\s*sh\s+<\s*\([^\r\n]*[\r\n]?$/m,

			// Network-based attacks
			/^\s*nc\s+-l\s+-p\s+\d+[^\r\n]*[\r\n]?$/m,
			/^\s*ncat\s+-l\s+-p\s+\d+[^\r\n]*[\r\n]?$/m,
			/^\s*python\s+.*SimpleHTTPServer[^\r\n]*[\r\n]?$/m,
			/^\s*python\s+.*http\.server[^\r\n]*[\r\n]?$/m,

			// Process manipulation
			/^\s*kill\s+-9\s+1\s*[\r\n]?$/m,
			/^\s*killall\s+-9\s+\*[^\r\n]*[\r\n]?$/m,

			// File system manipulation
			/^\s*chmod\s+777\s+\/[^\r\n]*[\r\n]?$/m,
			/^\s*chown\s+[^\s]+\s+\/[^\r\n]*[\r\n]?$/m,

			// Sensitive file access attempts
			/^\s*cat\s+\/etc\/passwd[^\r\n]*[\r\n]?$/m,
			/^\s*cat\s+\/etc\/shadow[^\r\n]*[\r\n]?$/m,
			/^\s*cat\s+\/root\/[^\r\n]*[\r\n]?$/m,

			// Only block null bytes
			/\x00/g,
		];

		// Check for dangerous patterns
		for (const pattern of dangerousPatterns) {
			if (pattern.test(data)) {
				console.warn(
					`Blocked potentially dangerous terminal command: ${data.substring(0, 50)}...`,
				);
				toast("Potentially dangerous command blocked for security", 3000);
				return;
			}
		}

		// Additional checks for suspicious character sequences
		if (data.includes("$(") && data.includes(")")) {
			const commandSubstitution = /\$\([^)]*\)/g;
			const matches = data.match(commandSubstitution);
			if (matches) {
				for (const match of matches) {
					// Check if command substitution contains dangerous commands
					for (const pattern of dangerousPatterns) {
						if (pattern.test(match)) {
							console.warn(
								`Blocked command substitution with dangerous content: ${match}`,
							);
							toast("Command substitution blocked for security", 3000);
							return;
						}
					}
				}
			}
		}

		// Sanitize data length to prevent memory exhaustion
		const maxLength = 64 * 1024; // 64KB max per write
		if (data.length > maxLength) {
			console.warn(
				`Terminal write data truncated - exceeded ${maxLength} characters`,
			);
			data = data.substring(0, maxLength) + "\n[Data truncated for security]\n";
		}

		// If all security checks pass, proceed with writing
		return TerminalManager.writeToTerminal(id, data);
	}

	/**
	 * Define a module
	 * @param {string} name
	 * @param {Object|function} module
	 */
	define(name, module) {
		this.#modules[name.toLowerCase()] = module;
	}

	require(module) {
		return this.#modules[module.toLowerCase()];
	}

	exec(key, val) {
		if (key in commands) {
			return commands[key](val);
		}
		return false;
	}

	/**
	 * Installs an Acode plugin from registry
	 * @param {string} pluginId id of the plugin to install
	 * @param {string} installerPluginName Name of plugin attempting to install
	 * @returns {Promise<void>}
	 */
	installPlugin(pluginId, installerPluginName) {
		return new Promise((resolve, reject) => {
			confirm(
				strings.install,
				`Do you want to install plugin '${pluginId}'${installerPluginName ? ` requested by ${installerPluginName}` : ""}?`,
			)
				.then((confirmation) => {
					if (!confirmation) {
						reject(new Error("User cancelled installation"));
						return;
					}

					fsOperation(Url.join(PLUGIN_DIR, pluginId))
						.exists()
						.then((isPluginExists) => {
							if (isPluginExists) {
								reject(new Error("Plugin already installed"));
								return;
							}

							let purchaseToken;
							let product;
							const pluginUrl = Url.join(
								constants.API_BASE,
								`plugin/${pluginId}`,
							);
							fsOperation(pluginUrl)
								.readFile("json")
								.catch(() => {
									reject(new Error("Failed to fetch plugin details"));
									return null;
								})
								.then((remotePlugin) => {
									if (remotePlugin) {
										const isPaid = remotePlugin.price > 0;
										helpers
											.promisify(iap.getProducts, [remotePlugin.sku])
											.then((products) => {
												[product] = products;
												if (product) {
													return getPurchase(product.productId);
												}
												return null;
											})
											.then((purchase) => {
												purchaseToken = purchase?.purchaseToken;

												if (isPaid && !purchaseToken) {
													if (!product) throw new Error("Product not found");
													return helpers.checkAPIStatus().then((apiStatus) => {
														if (!apiStatus) {
															alert(strings.error, strings.api_error);
															return;
														}

														iap.setPurchaseUpdatedListener(
															...purchaseListener(onpurchase, onerror),
														);
														return helpers.promisify(
															iap.purchase,
															product.productId,
														);
													});
												}
											})
											.then(() => {
												import("lib/installPlugin").then(
													({ default: installPlugin }) => {
														installPlugin(
															pluginId,
															remotePlugin.name,
															purchaseToken,
														).then(() => {
															resolve();
														});
													},
												);
											});

										async function onpurchase(e) {
											const purchase = await getPurchase(product.productId);
											await ajax.post(
												Url.join(constants.API_BASE, "plugin/order"),
												{
													data: {
														id: remotePlugin.id,
														token: purchase?.purchaseToken,
														package: BuildInfo.packageName,
													},
												},
											);
											purchaseToken = purchase?.purchaseToken;
										}

										async function onerror(error) {
											throw error;
										}
									}
								});

							async function getPurchase(sku) {
								const purchases = await helpers.promisify(iap.getPurchases);
								const purchase = purchases.find((p) =>
									p.productIds.includes(sku),
								);
								return purchase;
							}
						});
				})
				.catch((error) => {
					reject(error);
				});
		});
	}

	get exitAppMessage() {
		const numFiles = editorManager.hasUnsavedFiles();
		if (numFiles) {
			return strings["unsaved files close app"];
		}
		return null;
	}

	setLoadingMessage(message) {
		document.body.setAttribute("data-small-msg", message);
	}

	/**
	 * Sets plugin init function
	 * @param {string} id
	 * @param {() => void} initFunction
	 * @param {{list: import('components/settingsPage').ListItem[], cb: (key: string, value: string)=>void}} settings
	 */
	setPluginInit(id, initFunction, settings) {
		this.#pluginsInit[id] = initFunction;

		if (!settings) return;
		appSettings.uiSettings[`plugin-${id}`] = settingsPage(
			id,
			settings.list,
			settings.cb,
		);
	}

	setPluginUnmount(id, unmountFunction) {
		this.#pluginUnmount[id] = unmountFunction;
	}

	/**
	 *
	 * @param {string} id plugin id
	 * @param {string} baseUrl local plugin url
	 * @param {HTMLElement} $page
	 */
	async initPlugin(id, baseUrl, $page, options) {
		if (id in this.#pluginsInit) {
			await this.#pluginsInit[id](baseUrl, $page, options);
		}
	}

	unmountPlugin(id) {
		if (id in this.#pluginUnmount) {
			this.#pluginUnmount[id]();
			fsOperation(Url.join(CACHE_STORAGE, id)).delete();
		}

		delete appSettings.uiSettings[`plugin-${id}`];
	}

	registerFormatter(id, extensions, format) {
		this.#formatter.unshift({
			id,
			exts: extensions,
			format,
		});
	}

	unregisterFormatter(id) {
		this.#formatter = this.#formatter.filter(
			(formatter) => formatter.id !== id,
		);
		const { formatter } = appSettings.value;
		for (const mode of Object.keys(formatter)) {
			if (formatter[mode] === id) {
				delete formatter[mode];
			}
		}
		appSettings.update(false);
	}

	async format(selectIfNull = true) {
		const file = editorManager.activeFile;
		const name = (file.session.getMode().$id || "").split("/").pop();
		const formatterId = appSettings.value.formatter[name];
		const formatter = this.#formatter.find(({ id }) => id === formatterId);

		await formatter?.format();

		if (!formatter && selectIfNull) {
			formatterSettings(name);
			this.#afterSelectFormatter(name);
			return;
		}
		if (!formatter && !selectIfNull) {
			toast(strings["please select a formatter"]);
		}
	}

	#afterSelectFormatter(name) {
		appSettings.on("update:formatter", format);

		function format() {
			appSettings.off("update:formatter", format);
			const id = appSettings.value.formatter[name];
			const formatter = this.#formatter.find(({ id: _id }) => _id === id);
			formatter?.format();
		}
	}

	fsOperation(file) {
		return fsOperation(file);
	}

	newEditorFile(filename, options) {
		new EditorFile(filename, options);
	}

	get formatters() {
		return this.#formatter.map(({ id, name, exts }) => ({
			id,
			name: name || id,
			exts,
		}));
	}

	/**
	 *
	 * @param {string[]} extensions
	 * @returns {Array<[id: String, name: String]>} options
	 */
	getFormatterFor(extensions) {
		const options = [[null, strings.none]];
		for (const { id, name, exts } of this.formatters) {
			const supports = exts.some((ext) => extensions.includes(ext));
			if (supports || exts.includes("*")) {
				options.push([id, name]);
			}
		}
		return options;
	}

	alert(title, message, onhide) {
		alert(title, message, onhide);
	}

	loader(title, message, cancel) {
		return loader.create(title, message, cancel);
	}

	joinUrl(...args) {
		return Url.join(...args);
	}

	addIcon(className, src) {
		let style = document.head.get(`style[icon="${className}"]`);
		if (!style) {
			style = (
				<style
					icon={className}
				>{`.icon.${className}{background-image: url(${src})}`}</style>
			);
			document.head.appendChild(style);
		}
	}

	async prompt(message, defaultValue, type, options) {
		const response = await prompt(message, defaultValue, type, options);
		return response;
	}

	async confirm(title, message) {
		const confirmation = await confirm(title, message);
		return confirmation;
	}

	async select(title, options, config) {
		const response = await select(title, options, config);
		return response;
	}

	async multiPrompt(title, inputs, help) {
		const values = await multiPrompt(title, inputs, help);
		return values;
	}

	async fileBrowser(mode, info, openLast) {
		const res = await FileBrowser(mode, info, openLast);
		return res;
	}

	async toInternalUrl(url) {
		const internalUrl = await helpers.toInternalUri(url);
		return internalUrl;
	}
	/**
	 * Push a notification
	 * @param {string} title Title of the notification
	 * @param {string} message Message body of the notification
	 * @param {Object} options Notification options
	 * @param {string} [options.icon] Icon for the notification, can be a URL or a base64 encoded image or icon class or svg string
	 * @param {boolean} [options.autoClose=true] Whether notification should auto close
	 * @param {Function} [options.action=null] Action callback when notification is clicked
	 * @param {('info'|'warning'|'error'|'success')} [options.type='info'] Type of notification
	 */
	pushNotification(
		title,
		message,
		{ icon, autoClose = true, action = null, type = "info" } = {},
	) {
		const nm = new NotificationManager();
		nm.pushNotification({
			title,
			message,
			icon,
			autoClose,
			action,
			type,
		});
	}

	/**
	 * Register a custom file type handler
	 * @param {string} id Unique identifier for the handler
	 * @param {Object} options Handler configuration
	 * @param {string[]} options.extensions File extensions to handle (without dots)
	 * @param {function} options.handleFile Function that handles the file opening
	 */
	registerFileHandler(id, options) {
		fileTypeHandler.registerFileHandler(id, options);
	}

	/**
	 * Unregister a file type handler
	 * @param {string} id The handler id to remove
	 */
	unregisterFileHandler(id) {
		fileTypeHandler.unregisterFileHandler(id);
	}
}
