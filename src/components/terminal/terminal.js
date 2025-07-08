/**
 * Terminal Component using xtermjs
 * Provides a pluggable and customizable terminal interface
 */

import { AttachAddon } from "@xterm/addon-attach";
import { FitAddon } from "@xterm/addon-fit";
import { ImageAddon } from "@xterm/addon-image";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal as Xterm } from "@xterm/xterm";
import confirm from "dialogs/confirm";
import fonts from "lib/fonts";
import appSettings from "lib/settings";
import LigaturesAddon from "./ligatures";
import { getTerminalSettings } from "./terminalDefaults";
import TerminalThemeManager from "./terminalThemeManager";

export default class TerminalComponent {
	constructor(options = {}) {
		// Get terminal settings from shared defaults
		const terminalSettings = getTerminalSettings();

		this.options = {
			allowProposedApi: true,
			scrollOnUserInput: true,
			rows: options.rows || 24,
			cols: options.cols || 80,
			fontSize: terminalSettings.fontSize,
			fontFamily: terminalSettings.fontFamily,
			fontWeight: terminalSettings.fontWeight,
			theme: TerminalThemeManager.getTheme(terminalSettings.theme),
			cursorBlink: terminalSettings.cursorBlink,
			cursorStyle: terminalSettings.cursorStyle,
			cursorInactiveStyle: terminalSettings.cursorInactiveStyle,
			scrollback: terminalSettings.scrollback,
			tabStopWidth: terminalSettings.tabStopWidth,
			convertEol: terminalSettings.convertEol,
			letterSpacing: terminalSettings.letterSpacing,
			...options,
		};

		this.terminal = null;
		this.fitAddon = null;
		this.attachAddon = null;
		this.unicode11Addon = null;
		this.searchAddon = null;
		this.webLinksAddon = null;
		this.imageAddon = null;
		this.ligaturesAddon = null;
		this.container = null;
		this.websocket = null;
		this.pid = null;
		this.isConnected = false;
		this.serverMode = options.serverMode !== false; // Default true

		this.init();
	}

	init() {
		this.terminal = new Xterm(this.options);

		// Initialize addons
		this.fitAddon = new FitAddon();
		this.unicode11Addon = new Unicode11Addon();
		this.searchAddon = new SearchAddon();
		this.webLinksAddon = new WebLinksAddon(async (event, uri) => {
			const linkOpenConfirm = await confirm(
				"Terminal",
				`Do you want to open ${uri} in browser?`,
			);
			if (linkOpenConfirm) {
				system.openInBrowser(uri);
			}
		});
		this.webglAddon = new WebglAddon();

		// Load addons
		this.terminal.loadAddon(this.fitAddon);
		this.terminal.loadAddon(this.unicode11Addon);
		this.terminal.loadAddon(this.searchAddon);
		this.terminal.loadAddon(this.webLinksAddon);

		// Load conditional addons based on settings
		const terminalSettings = getTerminalSettings();

		// Load image addon if enabled
		if (terminalSettings.imageSupport) {
			this.loadImageAddon();
		}

		// Load font if specified
		this.loadTerminalFont();

		// Set up terminal event handlers
		this.setupEventHandlers();
	}

	setupEventHandlers() {
		// Handle terminal resize
		this.terminal.onResize((size) => {
			if (this.serverMode) {
				this.resizeTerminal(size.cols, size.rows);
			}
		});

		// Handle terminal title changes
		this.terminal.onTitleChange((title) => {
			this.onTitleChange?.(title);
		});

		// Handle bell
		this.terminal.onBell(() => {
			this.onBell?.();
		});

		// Handle copy/paste keybindings
		this.setupCopyPasteHandlers();
	}

	/**
	 * Setup copy/paste keyboard handlers
	 */
	setupCopyPasteHandlers() {
		// Add keyboard event listener to terminal element
		this.terminal.attachCustomKeyEventHandler((event) => {
			// Check for Ctrl+Shift+C (copy)
			if (event.ctrlKey && event.shiftKey && event.key === "C") {
				event.preventDefault();
				this.copySelection();
				return false;
			}

			// Check for Ctrl+Shift+V (paste)
			if (event.ctrlKey && event.shiftKey && event.key === "V") {
				event.preventDefault();
				this.pasteFromClipboard();
				return false;
			}

			// Return true to allow normal processing for other keys
			return true;
		});
	}

	/**
	 * Copy selected text to clipboard
	 */
	copySelection() {
		if (!this.terminal?.hasSelection()) return;
		const selectedStr = this.terminal?.getSelection();
		if (selectedStr && cordova?.plugins?.clipboard) {
			cordova.plugins.clipboard.copy(selectedStr);
		}
	}

	/**
	 * Paste text from clipboard
	 */
	pasteFromClipboard() {
		if (cordova?.plugins?.clipboard) {
			cordova.plugins.clipboard.paste((text) => {
				this.terminal?.paste(text);
			});
		}
	}

	/**
	 * Create terminal container element
	 * @returns {HTMLElement} Container element
	 */
	createContainer() {
		this.container = document.createElement("div");
		this.container.className = "terminal-container";
		this.container.style.cssText = `
      width: 100%;
      height: 100%;
      position: relative;
      background: ${this.options.theme.background};
      border-radius: 4px;
      overflow: hidden;
    `;

		return this.container;
	}

	/**
	 * Mount terminal to container
	 * @param {HTMLElement} container - Container element
	 */
	mount(container) {
		if (!container) {
			container = this.createContainer();
		}

		this.container = container;

		try {
			try {
				this.terminal.loadAddon(this.webglAddon);
				this.terminal.open(container);
			} catch (error) {
				console.error("Failed to load WebglAddon:", error);
				this.webglAddon.dispose();
			}

			if (!this.terminal.element) {
				// webgl loading failed for some reason, attach with DOM renderer
				this.terminal.open(container);
			}
			const terminalSettings = getTerminalSettings();
			// Load ligatures addon if enabled
			if (terminalSettings.fontLigatures) {
				this.loadLigaturesAddon();
			}

			// Wait for terminal to render then fit
			setTimeout(() => {
				this.fitAddon.fit();
				this.terminal.focus();
			}, 10);
		} catch (error) {
			console.error("Failed to mount terminal:", error);
		}

		return container;
	}

	/**
	 * Create new terminal session using global Terminal API
	 * @returns {Promise<string>} Terminal PID
	 */
	async createSession() {
		if (!this.serverMode) {
			throw new Error(
				"Terminal is in local mode, cannot create server session",
			);
		}

		try {
			// Check if terminal is installed before starting AXS
			if (!(await Terminal.isInstalled())) {
				throw new Error(
					"Terminal not installed. Please install terminal first.",
				);
			}

			// Start AXS if not running
			if (!(await Terminal.isAxsRunning())) {
				await Terminal.startAxs(false, () => {}, console.error);

				// Check if AXS started with interval polling
				const maxRetries = 10;
				let retries = 0;
				while (retries < maxRetries) {
					await new Promise((resolve) => setTimeout(resolve, 1000));
					if (await Terminal.isAxsRunning()) {
						break;
					}
					retries++;
				}

				// If AXS still not running after retries, throw error
				if (!(await Terminal.isAxsRunning())) {
					throw new Error("Failed to start AXS server after multiple attempts");
				}
			}

			const requestBody = {
				cols: this.terminal.cols,
				rows: this.terminal.rows,
			};

			const response = await fetch("http://localhost:8767/terminals", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(requestBody),
			});

			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}

			const data = await response.text();
			this.pid = data.trim();
			return this.pid;
		} catch (error) {
			console.error("Failed to create terminal session:", error);
			throw error;
		}
	}

	/**
	 * Connect to terminal session via WebSocket
	 * @param {string} pid - Terminal PID
	 */
	async connectToSession(pid) {
		if (!this.serverMode) {
			throw new Error(
				"Terminal is in local mode, cannot connect to server session",
			);
		}

		if (!pid) {
			pid = await this.createSession();
		}

		this.pid = pid;

		const wsUrl = `ws://localhost:8767/terminals/${pid}`;

		this.websocket = new WebSocket(wsUrl);

		this.websocket.onopen = () => {
			this.isConnected = true;
			this.onConnect?.();

			// Load attach addon after connection
			this.attachAddon = new AttachAddon(this.websocket);
			this.terminal.loadAddon(this.attachAddon);
			this.terminal.unicode.activeVersion = "11";

			// Focus terminal and ensure it's ready
			this.terminal.focus();
			this.fit();
		};

		this.websocket.onclose = (event) => {
			this.isConnected = false;
			this.onDisconnect?.();
		};

		this.websocket.onerror = (error) => {
			console.error("WebSocket error:", error);
			this.onError?.(error);
		};
	}

	/**
	 * Resize terminal
	 * @param {number} cols - Number of columns
	 * @param {number} rows - Number of rows
	 */
	async resizeTerminal(cols, rows) {
		if (!this.pid || !this.serverMode) return;

		try {
			await fetch(`http://localhost:8767/terminals/${this.pid}/resize`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ cols, rows }),
			});
		} catch (error) {
			console.error("Failed to resize terminal:", error);
		}
	}

	/**
	 * Fit terminal to container
	 */
	fit() {
		if (this.fitAddon) {
			this.fitAddon.fit();
		}
	}

	/**
	 * Write data to terminal
	 * @param {string} data - Data to write
	 */
	write(data) {
		this.terminal.write(data);
	}

	/**
	 * Write line to terminal
	 * @param {string} data - Data to write
	 */
	writeln(data) {
		this.terminal.writeln(data);
	}

	/**
	 * Clear terminal
	 */
	clear() {
		this.terminal.clear();
	}

	/**
	 * Focus terminal
	 */
	focus() {
		this.terminal.focus();
	}

	/**
	 * Blur terminal
	 */
	blur() {
		this.terminal.blur();
	}

	/**
	 * Search in terminal
	 * @param {string} term - Search term
	 * @param {number} skip Number of search results to skip
	 * @param {boolean} backward Whether to search backward
	 */
	search(term, skip, backward) {
		if (this.searchAddon) {
			const searchOptions = {
				regex: appSettings.value.search.regExp || false,
				wholeWord: appSettings.value.search.wholeWord || false,
				caseSensitive: appSettings.value.search.caseSensitive || false,
				decorations: {
					matchBorder: "#FFA500",
					activeMatchBorder: "#FFFF00",
				},
			};
			if (!term) {
				return false;
			}

			if (backward) {
				return this.searchAddon.findPrevious(term, searchOptions);
			} else {
				return this.searchAddon.findNext(term, searchOptions);
			}
		}
		return false;
	}

	/**
	 * Update terminal theme
	 * @param {object|string} theme - Theme object or theme name
	 */
	updateTheme(theme) {
		if (typeof theme === "string") {
			theme = TerminalThemeManager.getTheme(theme);
		}
		this.options.theme = { ...this.options.theme, ...theme };
		this.terminal.options.theme = this.options.theme;
	}

	/**
	 * Update terminal options
	 * @param {object} options - Options to update
	 */
	updateOptions(options) {
		Object.keys(options).forEach((key) => {
			if (key === "theme") {
				this.updateTheme(options.theme);
			} else {
				this.terminal.options[key] = options[key];
				this.options[key] = options[key];
			}
		});
	}

	/**
	 * Load image addon
	 */
	loadImageAddon() {
		if (!this.imageAddon) {
			try {
				this.imageAddon = new ImageAddon();
				this.terminal.loadAddon(this.imageAddon);
			} catch (error) {
				console.error("Failed to load ImageAddon:", error);
			}
		}
	}

	/**
	 * Dispose image addon
	 */
	disposeImageAddon() {
		if (this.imageAddon) {
			try {
				this.imageAddon.dispose();
				this.imageAddon = null;
			} catch (error) {
				console.error("Failed to dispose ImageAddon:", error);
			}
		}
	}

	/**
	 * Update image support setting
	 * @param {boolean} enabled - Whether to enable image support
	 */
	updateImageSupport(enabled) {
		if (enabled) {
			this.loadImageAddon();
		} else {
			this.disposeImageAddon();
		}
	}

	/**
	 * Load ligatures addon
	 */
	loadLigaturesAddon() {
		if (!this.ligaturesAddon) {
			try {
				this.ligaturesAddon = new LigaturesAddon();
				this.terminal.loadAddon(this.ligaturesAddon);
			} catch (error) {
				console.error("Failed to load LigaturesAddon:", error);
			}
		}
	}

	/**
	 * Dispose ligatures addon
	 */
	disposeLigaturesAddon() {
		if (this.ligaturesAddon) {
			try {
				this.ligaturesAddon.dispose();
				this.ligaturesAddon = null;
			} catch (error) {
				console.error("Failed to dispose LigaturesAddon:", error);
			}
		}
	}

	/**
	 * Update font ligatures setting
	 * @param {boolean} enabled - Whether to enable font ligatures
	 */
	updateFontLigatures(enabled) {
		if (enabled) {
			this.loadLigaturesAddon();
		} else {
			this.disposeLigaturesAddon();
		}
	}

	/**
	 * Load terminal font if it's not already loaded
	 */
	async loadTerminalFont() {
		const fontFamily = this.options.fontFamily;
		if (fontFamily && fonts.get(fontFamily)) {
			try {
				await fonts.loadFont(fontFamily);
			} catch (error) {
				console.warn(`Failed to load terminal font ${fontFamily}:`, error);
			}
		}
	}

	/**
	 * Terminate terminal session
	 */
	async terminate() {
		if (this.websocket) {
			this.websocket.close();
		}

		if (this.pid && this.serverMode) {
			try {
				await fetch(`http://localhost:8767/terminals/${this.pid}/terminate`, {
					method: "POST",
				});
			} catch (error) {
				console.error("Failed to terminate terminal:", error);
			}
		}
	}

	/**
	 * Dispose terminal
	 */
	dispose() {
		this.terminate();

		// Dispose addons
		this.disposeImageAddon();
		this.disposeLigaturesAddon();

		if (this.terminal) {
			this.terminal.dispose();
		}

		if (this.container) {
			this.container.remove();
		}
	}

	// Event handlers (can be overridden)
	onConnect() {}
	onDisconnect() {}
	onError(error) {}
	onTitleChange(title) {}
	onBell() {}
}
