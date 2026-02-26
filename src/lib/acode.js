import fsOperation from "fileSystem";
import sidebarApps from "sidebarApps";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorState, Prec, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import ajax from "@deadlyjack/ajax";
import { tags } from "@lezer/highlight";
import {
	getRegisteredCommands as listRegisteredCommands,
	refreshCommandKeymap,
	registerExternalCommand,
	removeExternalCommand,
	executeCommand as runCommand,
} from "cm/commandRegistry";
import lspClientManager from "cm/lsp/clientManager";
import { registerLspFormatter } from "cm/lsp/formatter";
import serverRegistry from "cm/lsp/serverRegistry";
import {
	addMode,
	getModeForPath,
	getModes,
	getModesByName,
	removeMode,
} from "cm/modelist";
import cmThemeRegistry from "cm/themes";
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
import {
	BROKEN_PLUGINS,
	LOADED_PLUGINS,
	onPluginLoadCallback,
	onPluginsLoadCompleteCallback,
} from "lib/loadPlugins";
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
	// Registered formatter implementations (populated by plugins)
	#formatter = [];
	#pluginWatchers = {};

	/**
	 * Clear a plugin's broken mark (so it can be retried)
	 * @param {string} pluginId
	 */
	clearBrokenPluginMark(pluginId) {
		try {
			if (BROKEN_PLUGINS.has(pluginId)) {
				BROKEN_PLUGINS.delete(pluginId);
			}
		} catch (e) {
			console.warn("Failed to clear broken plugin mark:", e);
		}
	}

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

		// CodeMirror editor theme API for plugins
		const normalizeThemeSpec = (spec) => {
			if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
				console.warn(
					"[editorThemes] register(spec) expects an object: { id, caption?, dark?, getExtension|extensions|extension|theme, config? }",
				);
				return null;
			}

			const id = spec.id || spec.name;
			if (!id) {
				console.warn("[editorThemes] register(spec) requires a valid `id`.");
				return null;
			}

			const extensionSource =
				spec.getExtension || spec.extensions || spec.extension || spec.theme;
			if (extensionSource === undefined || extensionSource === null) {
				console.warn(
					`[editorThemes] register('${id}') requires extensions via getExtension/extensions/extension/theme.`,
				);
				return null;
			}

			return {
				id,
				caption: spec.caption || spec.label || id,
				isDark: spec.isDark ?? spec.dark ?? false,
				getExtension:
					typeof extensionSource === "function"
						? extensionSource
						: () => extensionSource,
				config: spec.config ?? null,
			};
		};

		const createHighlightStyle = (spec) => {
			if (!spec) return null;
			if (Array.isArray(spec)) return HighlightStyle.define(spec);
			return spec;
		};

		const createTheme = ({
			styles,
			dark = false,
			highlightStyle,
			extensions = [],
		} = {}) => {
			const ext = [];

			if (styles && typeof styles === "object") {
				ext.push(EditorView.theme(styles, { dark: !!dark }));
			}

			const resolvedHighlight = createHighlightStyle(highlightStyle);
			if (resolvedHighlight) {
				ext.push(syntaxHighlighting(resolvedHighlight));
			}

			if (Array.isArray(extensions)) {
				ext.push(...extensions);
			} else if (extensions) {
				ext.push(extensions);
			}

			return ext;
		};

		const editorThemesModule = {
			/**
			 * Register a CodeMirror theme from plugin code.
			 * @param {{
			 *   id: string,
			 *   caption?: string,
			 *   dark?: boolean,
			 *   getExtension?: Function,
			 *   extensions?: unknown,
			 *   config?: object
			 * }} spec
			 * `isDark`, `extension`, and `theme` are accepted aliases for compatibility.
			 * @returns {boolean}
			 */
			register: (spec) => {
				const resolved = normalizeThemeSpec(spec);
				if (!resolved) return false;
				return cmThemeRegistry.addTheme(
					resolved.id,
					resolved.caption,
					resolved.isDark,
					resolved.getExtension,
					resolved.config,
				);
			},
			unregister: (id) => cmThemeRegistry.removeTheme(id),
			list: () => cmThemeRegistry.getThemes(),
			apply: (id) => editorManager?.editor?.setTheme?.(id),
			get: (id) => cmThemeRegistry.getThemeById(id),
			getConfig: (id) => cmThemeRegistry.getThemeConfig(id),
			createTheme,
			createHighlightStyle,
			cm: {
				EditorView,
				HighlightStyle,
				syntaxHighlighting,
				tags,
			},
		};

		const sidebarAppsModule = {
			add: sidebarApps.add,
			get: sidebarApps.get,
			remove: sidebarApps.remove,
		};

		const lspModule = {
			registerServer: (definition, options) =>
				serverRegistry.registerServer(definition, options),
			unregisterServer: (id) => serverRegistry.unregisterServer(id),
			updateServer: (id, updater) => serverRegistry.updateServer(id, updater),
			getServer: (id) => serverRegistry.getServer(id),
			listServers: () => serverRegistry.listServers(),
			getServersForLanguage: (languageId, options) =>
				serverRegistry.getServersForLanguage(languageId, options),
			clientManager: {
				setOptions: (options) => lspClientManager.setOptions(options),
				getActiveClients: () => lspClientManager.getActiveClients(),
			},
		};

		const getModeByName = (name) => {
			const normalized = String(name || "")
				.trim()
				.toLowerCase();
			if (!normalized) return null;
			return getModesByName()[normalized] || null;
		};

		const listModes = () => [...getModes()];
		const listModesByName = () => ({ ...getModesByName() });

		const aceModes = {
			addMode,
			removeMode,
			getModeForPath: (path) => getModeForPath(String(path || "")),
			getModes: () => listModes(),
			getModesByName: () => listModesByName(),
			getMode: (name) => getModeByName(name),
		};

		// Preferred CodeMirror language registration API for plugins
		const editorLanguages = {
			// name: string, extensions: string|Array<string>, caption?: string,
			// loader?: () => Extension | Promise<Extension>
			register: (name, extensions, caption, loader) =>
				addMode(name, extensions, caption, loader),
			unregister: (name) => removeMode(name),
			add: (name, extensions, caption, loader) =>
				addMode(name, extensions, caption, loader),
			remove: (name) => removeMode(name),
			list: () => listModes(),
			listByName: () => listModesByName(),
			get: (name) => getModeByName(name),
			getForPath: (path) => getModeForPath(String(path || "")),
		};

		const intent = {
			addHandler: addIntentHandler,
			removeHandler: removeIntentHandler,
		};

		const terminalTouchSelectionMoreOptions = {
			add: (option) => TerminalManager.addTouchSelectionMoreOption(option),
			remove: (id) => TerminalManager.removeTouchSelectionMoreOption(id),
			list: () => TerminalManager.getTouchSelectionMoreOptions(),
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
			moreOptions: terminalTouchSelectionMoreOptions,
			touchSelection: {
				moreOptions: terminalTouchSelectionMoreOptions,
			},
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
		this.define("editorLanguages", editorLanguages);
		this.define("editorThemes", editorThemesModule);
		this.define("lsp", lspModule);
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
		this.define("commands", this.#createCommandApi());

		registerLspFormatter(this);
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
			fsOperation(Url.join(PLUGIN_DIR, pluginId))
				.exists()
				.then((isPluginExists) => {
					if (isPluginExists) {
						reject(new Error("Plugin already installed"));
						return;
					}

					confirm(
						strings.install,
						`Do you want to install plugin '${pluginId}'${installerPluginName ? ` requested by ${installerPluginName}` : ""}?`,
					).then((confirmation) => {
						if (!confirmation) {
							reject(new Error("User cancelled installation"));
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

	[onPluginLoadCallback](pluginId) {
		if (this.#pluginWatchers[pluginId]) {
			this.#pluginWatchers[pluginId].resolve();
			delete this.#pluginWatchers[pluginId];
		}
	}

	[onPluginsLoadCompleteCallback]() {
		for (const pluginId in this.#pluginWatchers) {
			this.#pluginWatchers[pluginId].reject(
				new Error(`Plugin '${pluginId}' failed to load.`),
			);
		}
		this.#pluginWatchers = {};
	}

	waitForPlugin(pluginId) {
		return new Promise((resolve, reject) => {
			if (LOADED_PLUGINS.has(pluginId)) {
				return resolve(true);
			}

			this.#pluginWatchers[pluginId] = {
				resolve,
				reject,
			};
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

	registerFormatter(id, extensions, format, displayName) {
		let exts;
		if (Array.isArray(extensions)) {
			exts = extensions.filter(Boolean);
			if (!exts.length) exts = ["*"];
		} else if (typeof extensions === "string" && extensions) {
			exts = [extensions];
		} else {
			exts = ["*"];
		}
		this.#formatter.unshift({
			id,
			name: displayName,
			exts: exts,
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
		if (!file || file.type !== "editor") return false;

		let resolvedMode = file.currentMode;
		if (!resolvedMode) {
			try {
				resolvedMode = getModeForPath(file.filename)?.name;
			} catch (_) {
				resolvedMode = null;
			}
		}
		const modeName = resolvedMode || "text";
		const formatterMap = appSettings.value.formatter || {};
		const formatterId = formatterMap[modeName];
		const formatter = this.#formatter.find(({ id }) => id === formatterId);

		if (!formatter) {
			if (formatterId) {
				delete formatterMap[modeName];
				await appSettings.update(false);
			}

			if (selectIfNull) {
				formatterSettings(modeName);
				this.#afterSelectFormatter(modeName);
			} else {
				toast(strings["please select a formatter"]);
			}
			return false;
		}

		try {
			await formatter.format();
			return true;
		} catch (error) {
			helpers.error(error);
			return false;
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

	/**
	 * Adds a custom icon class that can be used with the .icon element
	 * @param {string} className - The class name for the icon (used as .icon.className)
	 * @param {string} src - URL or data URI of the icon image
	 * @param {object} [options] - Optional settings
	 * @param {boolean} [options.monochrome=false] - If true, icon will use currentColor and adapt to theme
	 */
	addIcon(className, src, options = {}) {
		let style = document.head.get(`style[icon="${className}"]`);
		if (!style) {
			let css;
			if (options.monochrome) {
				// Monochrome icons: use mask-image (on ::before) for currentColor/theme support
				// Using ::before ensures we don't mask the ::after active indicator or the background
				css = `.icon.${className}::before {
					content: '';
					display: inline-block;
					width: 24px;
					height: 24px;
					vertical-align: middle;
					-webkit-mask: url(${src}) no-repeat center / contain;
					mask: url(${src}) no-repeat center / contain;
					background-color: currentColor;
				}`;
			} else {
				// Default: preserve original icon colors
				css = `.icon.${className}{
					background: url(${src}) no-repeat center / 24px;
				}`;
			}
			style = <style icon={className}>{css}</style>;
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

	addCommand(descriptor) {
		const command = registerExternalCommand(descriptor);
		this.#refreshCommandBindings();
		return command;
	}

	removeCommand(name) {
		if (!name) return;
		removeExternalCommand(name);
		this.#refreshCommandBindings();
	}

	execCommand(name, view, args) {
		if (!name) return false;
		const targetView = view || window.editorManager?.editor;
		return runCommand(name, targetView, args);
	}

	listCommands() {
		return listRegisteredCommands();
	}

	#refreshCommandBindings() {
		const view = window.editorManager?.editor;
		if (view) refreshCommandKeymap(view);
	}

	#createCommandApi() {
		const commandRegistry = {
			add: this.addCommand,
			execute: this.execCommand,
			remove: this.removeCommand,
			list: this.listCommands,
		};

		const addCommand = (descriptor) => {
			try {
				return this.addCommand(descriptor);
			} catch (error) {
				console.error("Failed to add command", descriptor?.name);
				throw error;
			}
		};

		const removeCommand = (name) => {
			if (!name) return;
			this.removeCommand(name);
		};

		return {
			addCommand,
			removeCommand,
			get registry() {
				return commandRegistry;
			},
		};
	}
}
