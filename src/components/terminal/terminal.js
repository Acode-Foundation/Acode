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
import toast from "components/toast";
import confirm from "dialogs/confirm";
import fonts from "lib/fonts";
import keyBindings from "lib/keyBindings";
import appSettings from "lib/settings";
import LigaturesAddon from "./ligatures";
import { getTerminalSettings } from "./terminalDefaults";
import TerminalThemeManager from "./terminalThemeManager";
import TerminalTouchSelection from "./terminalTouchSelection";

export default class TerminalComponent {
	constructor(options = {}) {
		// Get terminal settings from shared defaults
		const terminalSettings = getTerminalSettings();

		this.options = {
			allowProposedApi: true,
			scrollOnUserInput: true,
			rows: options.rows || 24,
			cols: options.cols || 80,
			port: options.port || 8767,
			renderer: options.renderer || "auto", // 'auto' | 'canvas' | 'webgl'
			fontSize: terminalSettings.fontSize,
			fontFamily: `"${terminalSettings.fontFamily}", monospace`,
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
		this.touchSelection = null;

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
		this.webglAddon = null;

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
		// terminal resize handling
		this.setupResizeHandling();

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

		// Handle custom OSC 7777 for acode CLI commands
		this.setupOscHandler();
	}

	/**
	 * Setup custom OSC handler for acode CLI integration
	 * OSC 7777 format: \e]7777;command;arg1;arg2;...\a
	 */
	setupOscHandler() {
		// Register custom OSC handler for ID 7777
		// Format: command;arg1;arg2;... where arg2 (path) may contain semicolons
		this.terminal.parser.registerOscHandler(7777, (data) => {
			const firstSemi = data.indexOf(";");
			if (firstSemi === -1) {
				console.warn("Invalid OSC 7777 format:", data);
				return true;
			}

			const command = data.substring(0, firstSemi);
			const rest = data.substring(firstSemi + 1);

			switch (command) {
				case "open": {
					// Format: open;type;path (path may contain semicolons)
					const secondSemi = rest.indexOf(";");
					if (secondSemi === -1) {
						console.warn("Invalid OSC 7777 open format:", data);
						return true;
					}
					const type = rest.substring(0, secondSemi);
					const path = rest.substring(secondSemi + 1);
					this.handleOscOpen(type, path);
					break;
				}
				default:
					console.warn("Unknown OSC 7777 command:", command);
			}
			return true;
		});
	}

	/**
	 * Handle OSC open command from acode CLI
	 * @param {string} type - "file" or "folder"
	 * @param {string} path - Path to open
	 */
	handleOscOpen(type, path) {
		if (!path) return;

		// Emit event for the app to handle
		this.onOscOpen?.(type, path);
	}

	/**
	 * Setup resize handling for keyboard events and content preservation
	 */
	setupResizeHandling() {
		let resizeTimeout = null;
		let lastKnownScrollPosition = 0;
		let isResizing = false;
		const RESIZE_DEBOUNCE = 100;

		// Store original dimensions for comparison
		let originalRows = this.terminal.rows;
		let originalCols = this.terminal.cols;

		this.terminal.onResize((size) => {
			isResizing = true;

			// Store current scroll position before resize
			if (this.terminal.buffer && this.terminal.buffer.active) {
				lastKnownScrollPosition = this.terminal.buffer.active.viewportY;
			}

			// Clear any existing timeout
			if (resizeTimeout) {
				clearTimeout(resizeTimeout);
			}

			// Debounced resize handling
			resizeTimeout = setTimeout(async () => {
				try {
					// Always sync cols/rows to backend PTY on every client resize.
					//
					// The original code only synced when heightRatio < 0.75 (the "keyboard resize"
					// heuristic below). That fails in several real scenarios on mobile:
					//   1. Small keyboard height changes (e.g. switching input methods, suggestion
					//      bar appearing/disappearing) shrink height by <25%, bypassing the threshold.
					//   2. Width-only changes (screen rotation, split-screen toggle) leave height
					//      unchanged so heightRatio ≈ 1.0, but cols change and PTY must know.
					//   3. Animated keyboard open/close fires many incremental resize events; each
					//      individual step is a tiny delta that never crosses 0.75, yet the
					//      accumulated drift corrupts output.
					//   4. Different ROMs / WebView versions report slightly different viewport sizes
					//      for the same keyboard, making any fixed threshold unreliable.
					//
					// Unconditionally syncing is cheap (one small HTTP POST per debounced resize)
					// and guarantees the PTY always matches the client grid.
					if (this.serverMode) {
						await this.resizeTerminal(size.cols, size.rows);
					}

					// Handle keyboard resize cursor positioning
					const heightRatio = size.rows / originalRows;
					if (
						heightRatio < 0.75 &&
						this.terminal.buffer &&
						this.terminal.buffer.active
					) {
						// Keyboard resize detected - ensure cursor is visible
						const buffer = this.terminal.buffer.active;
						const cursorY = buffer.cursorY;
						const cursorViewportPos = buffer.baseY + cursorY;
						const viewportTop = buffer.viewportY;
						const viewportBottom = viewportTop + this.terminal.rows - 1;

						if (
							cursorViewportPos <= viewportTop + 1 ||
							cursorViewportPos >= viewportBottom - 1
						) {
							const targetScroll = Math.max(
								0,
								Math.min(
									buffer.length - this.terminal.rows,
									cursorViewportPos - Math.floor(this.terminal.rows * 0.25),
								),
							);
							this.terminal.scrollToLine(targetScroll);
						}
					} else {
						// Regular resize - preserve scroll position
						this.preserveViewportPosition(lastKnownScrollPosition);
					}

					// Update stored dimensions
					originalRows = size.rows;
					originalCols = size.cols;

					// Mark resize as complete
					isResizing = false;

					// Notify touch selection if it exists
					if (this.touchSelection) {
						this.touchSelection.onTerminalResize(size);
					}
				} catch (error) {
					console.error("Resize handling failed:", error);
					isResizing = false;
				}
			}, RESIZE_DEBOUNCE);
		});

		// Also handle viewport changes for scroll position preservation
		this.terminal.onData(() => {
			// If we're not resizing and user types, everything is stable
			if (!isResizing && this.terminal.buffer && this.terminal.buffer.active) {
				lastKnownScrollPosition = this.terminal.buffer.active.viewportY;
			}
		});
	}

	/**
	 * Preserve viewport position during resize to prevent jumping
	 */
	preserveViewportPosition(targetScrollPosition) {
		if (!this.terminal.buffer || !this.terminal.buffer.active) return;

		const buffer = this.terminal.buffer.active;
		const maxScroll = Math.max(0, buffer.length - this.terminal.rows);

		// Ensure scroll position is within valid bounds
		const safeScrollPosition = Math.min(targetScrollPosition, maxScroll);

		// Only adjust if we have significant content and the position differs
		if (
			buffer.length > this.terminal.rows &&
			buffer.viewportY !== safeScrollPosition
		) {
			this.terminal.scrollToLine(safeScrollPosition);
		}
	}

	/**
	 * Setup touch selection for mobile devices
	 */
	setupTouchSelection() {
		// Only initialize touch selection on mobile devices
		if (window.cordova && this.container) {
			const terminalSettings = getTerminalSettings();
			this.touchSelection = new TerminalTouchSelection(
				this.terminal,
				this.container,
				{
					tapHoldDuration:
						terminalSettings.touchSelectionTapHoldDuration || 600,
					moveThreshold: terminalSettings.touchSelectionMoveThreshold || 8,
					handleSize: terminalSettings.touchSelectionHandleSize || 24,
					hapticFeedback:
						terminalSettings.touchSelectionHapticFeedback !== false,
					showContextMenu:
						terminalSettings.touchSelectionShowContextMenu !== false,
					onFontSizeChange: (fontSize) => this.updateFontSize(fontSize),
				},
			);
		}
	}

	/**
	 * Parse app keybindings into a format usable by the keyboard handler
	 */
	parseAppKeybindings() {
		const parsedBindings = [];

		Object.values(keyBindings).forEach((binding) => {
			if (!binding.key) return;

			// Skip editor-only keybindings in terminal
			if (binding.editorOnly) return;

			// Handle multiple key combinations separated by |
			const keys = binding.key.split("|");

			keys.forEach((keyCombo) => {
				const parts = keyCombo.split("-");
				const parsed = {
					ctrl: false,
					shift: false,
					alt: false,
					meta: false,
					key: "",
				};

				parts.forEach((part) => {
					const lowerPart = part.toLowerCase();
					if (lowerPart === "ctrl") {
						parsed.ctrl = true;
					} else if (lowerPart === "shift") {
						parsed.shift = true;
					} else if (lowerPart === "alt") {
						parsed.alt = true;
					} else if (lowerPart === "meta" || lowerPart === "cmd") {
						parsed.meta = true;
					} else {
						// This is the actual key
						parsed.key = part;
					}
				});

				if (parsed.key) {
					parsedBindings.push(parsed);
				}
			});
		});

		return parsedBindings;
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

			// Check for Ctrl+= or Ctrl++ (increase font size)
			if (event.ctrlKey && (event.key === "+" || event.key === "=")) {
				event.preventDefault();
				this.increaseFontSize();
				return false;
			}

			// Check for Ctrl+- (decrease font size)
			if (event.ctrlKey && event.key === "-") {
				event.preventDefault();
				this.decreaseFontSize();
				return false;
			}

			// Only intercept specific app-wide keybindings, let terminal handle the rest
			if (event.ctrlKey || event.altKey || event.metaKey) {
				// Skip modifier-only keys
				if (["Control", "Alt", "Meta", "Shift"].includes(event.key)) {
					return true;
				}

				// Get parsed app keybindings
				const appKeybindings = this.parseAppKeybindings();

				// Check if this is an app-specific keybinding
				const isAppKeybinding = appKeybindings.some(
					(binding) =>
						binding.ctrl === event.ctrlKey &&
						binding.shift === event.shiftKey &&
						binding.alt === event.altKey &&
						binding.meta === event.metaKey &&
						binding.key === event.key,
				);

				if (isAppKeybinding) {
					const appEvent = new KeyboardEvent("keydown", {
						key: event.key,
						ctrlKey: event.ctrlKey,
						shiftKey: event.shiftKey,
						altKey: event.altKey,
						metaKey: event.metaKey,
						bubbles: true,
						cancelable: true,
					});

					// Dispatch to document so it gets picked up by the app's keyboard handler
					document.dispatchEvent(appEvent);

					// Return false to prevent terminal from processing this key
					return false;
				}

				// For all other modifier combinations, let the terminal handle them
				return true;
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
      overflow: hidden;
      box-sizing: border-box;
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

		// Apply terminal background color to container to match theme
		this.container.style.background = this.options.theme.background;

		try {
			// Open first to ensure a stable renderer is attached
			this.terminal.open(container);

			// Renderer selection: 'canvas' (default core), 'webgl', or 'auto'
			if (
				this.options.renderer === "webgl" ||
				this.options.renderer === "auto"
			) {
				try {
					const addon = new WebglAddon();
					this.terminal.loadAddon(addon);
					if (typeof addon.onContextLoss === "function") {
						addon.onContextLoss(() => this._handleWebglContextLoss());
					}
					this.webglAddon = addon;
				} catch (error) {
					console.error("Failed to enable WebGL renderer:", error);
					try {
						this.webglAddon?.dispose?.();
					} catch {}
					this.webglAddon = null; // stay on canvas
				}
			}
			const terminalSettings = getTerminalSettings();
			// Load ligatures addon if enabled
			if (terminalSettings.fontLigatures) {
				this.loadLigaturesAddon();
			}

			// First render pass: schedule a fit + focus once the frame is ready
			if (typeof requestAnimationFrame === "function") {
				requestAnimationFrame(() => {
					this.fitAddon.fit();
					this.terminal.focus();
					this.setupTouchSelection();
				});
			} else {
				setTimeout(() => {
					this.fitAddon.fit();
					this.terminal.focus();
					this.setupTouchSelection();
				}, 0);
			}
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
			const installed = await Terminal.isInstalled();
			if (!installed) {
				throw new Error(
					"Terminal not installed. Please install terminal first.",
				);
			}

			// Start AXS if not running
			const axsRunning = await Terminal.isAxsRunning();

			// Poll by hitting the actual HTTP endpoint, not just checking PID liveness.
			// isAxsRunning() only does kill -0 on the PID file, which can return true
			// while the HTTP server inside proot is still booting.
			const pollAxs = async (maxRetries = 30, intervalMs = 1000) => {
				for (let i = 0; i < maxRetries; i++) {
					await new Promise((r) => setTimeout(r, intervalMs));
					try {
						const resp = await fetch(`http://localhost:${this.options.port}/`, { method: 'GET', signal: AbortSignal.timeout(2000) });
						if (resp.ok || resp.status < 500) return true;
					} catch (_) {
						// HTTP not yet reachable
					}
				}
				return false;
			};

			if (!axsRunning) {
				// In debug builds, refresh axs binary from assets before starting
				await Terminal.refreshAxsBinary();
				await Terminal.startAxs(false, () => {}, console.error);

				// Wait for axs HTTP server to become reachable
				const pollResult = await pollAxs(30);
				if (!pollResult) {
					// AXS failed to start — attempt auto-repair
					toast("Repairing terminal environment...");

					try { await Terminal.stopAxs(); } catch (_) { /* ignore */ }

					// Re-run installing flow to repair packages / config
					const repairOk = await Terminal.startAxs(true, console.log, console.error);
					if (repairOk) {
						// Start AXS again after repair
						await Terminal.startAxs(false, () => {}, console.error);
					}

					if (!(await pollAxs(30))) {
						// Still broken — clear .configured so next open re-triggers install
						try { await Terminal.resetConfigured(); } catch (_) { /* ignore */ }
						throw new Error("Failed to start AXS server after repair attempt");
					}
				}
			}

			const requestBody = {
				cols: this.terminal.cols,
				rows: this.terminal.rows,
			};

			const response = await fetch(
				`http://localhost:${this.options.port}/terminals`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify(requestBody),
				},
			);

			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}

			const data = await response.text();

			// Detect PTY errors from axs server (e.g. incompatible binary)
			if (data.includes('"error"') && data.includes('Failed to open PTY')) {
				const refreshed = await Terminal.refreshAxsBinary();
				if (refreshed) {
					// Kill old axs, restart with fresh binary, and retry once
					try { await Terminal.stopAxs(); } catch (_) {}
					await Terminal.startAxs(false, () => {}, console.error);
					const pollResult = await pollAxs(30);
					if (pollResult) {
						const retryResp = await fetch(
							`http://localhost:${this.options.port}/terminals`,
							{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody) },
						);
						if (retryResp.ok) {
							const retryData = await retryResp.text();
							if (!retryData.includes('"error"')) {
								this.pid = retryData.trim();
								return this.pid;
							}
						}
					}
				}
				throw new Error('Failed to open PTY even after refreshing AXS binary');
			}

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

		const wsUrl = `ws://localhost:${this.options.port}/terminals/${pid}`;

		this.websocket = new WebSocket(wsUrl);

		this.websocket.onopen = () => {
			this.isConnected = true;
			this.onConnect?.();

			// Explicitly dispose old AttachAddon before replacing it.
			// Reassigning this.attachAddon does NOT auto-clean listeners bound by the old instance,
			// which can cause duplicate socket handlers and leaks after reconnects.
			if (this.attachAddon) {
				try { this.attachAddon.dispose(); } catch (_) {}
				this.attachAddon = null;
			}

			// Load attach addon after connection
			this.attachAddon = new AttachAddon(this.websocket);
			this.terminal.loadAddon(this.attachAddon);
			this.terminal.unicode.activeVersion = "11";

			// Focus terminal and ensure it's ready
			this.terminal.focus();
			this.fit();
		};

		this.websocket.onmessage = (event) => {
			// Handle text messages (exit events)
			if (typeof event.data === "string") {
				try {
					const message = JSON.parse(event.data);
					if (message.type === "exit") {
						this.onProcessExit?.(message.data);
						return;
					}
				} catch (error) {
					// Not a JSON message, let attachAddon handle it
				}
			}
			// For binary data or non-exit text messages, let attachAddon handle them
		};

		// Also sniff the data to detect critical Alpine container corruption (e.g. bash/readline broken)
		this.websocket.addEventListener("message", async (event) => {
			try {
				let text = "";
				if (typeof event.data === "string") {
					text = event.data;
				} else if (event.data instanceof ArrayBuffer || event.data instanceof Blob) {
					text = await new Response(event.data).text();
				}
				
				if (text.includes("Error relocating") && text.includes("symbol not found")) {
					console.error("Detected critical Alpine libc corruption! Terminating and triggering reinstall.");
					if (this.onCrashData) {
						this.onCrashData("relocation_error");
					}
				}
			} catch (err) {}
		});

		this.websocket.onclose = (event) => {
			this.isConnected = false;
			this.onDisconnect?.();
		};

		this.websocket.onerror = (error) => {
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
			await fetch(
				`http://localhost:${this.options.port}/terminals/${this.pid}/resize`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ cols, rows }),
				},
			);
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
		if (
			this.serverMode &&
			this.isConnected &&
			this.websocket &&
			this.websocket.readyState === WebSocket.OPEN
		) {
			// Send data through WebSocket instead of direct write
			this.websocket.send(data);
		} else {
			// For local mode or disconnected terminals, write directly
			this.terminal.write(data);
		}
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
		// Use original name without quotes for Acode fonts.get
		const fontFamily = this.options.fontFamily.replace(/^"|"$/g, '').replace(/",\s*monospace$/, '');
		if (fontFamily && fonts.get(fontFamily)) {
			try {
				await fonts.loadFont(fontFamily);
				// Make Xterm.js aware that the font is fully loaded
				// Setting options.fontFamily triggers a re-eval of character dimensions
				if (this.terminal) {
					this.terminal.options.fontFamily = `"${fontFamily}", monospace`;
					if (this.webglAddon) {
						try { this.webglAddon.clearTextureAtlas(); } catch (e) {}
					}
					// Ensure terminal dimensions are updated after font load changes char size
					setTimeout(() => this.fit(), 100);
				}
			} catch (error) {
				console.warn(`Failed to load terminal font ${fontFamily}:`, error);
			}
		}
	}

	/**
	 * Increase terminal font size
	 */
	increaseFontSize() {
		const currentSize = this.terminal.options.fontSize;
		const newSize = Math.min(currentSize + 1, 24); // Max font size 24
		this.updateFontSize(newSize);
	}

	/**
	 * Decrease terminal font size
	 */
	decreaseFontSize() {
		const currentSize = this.terminal.options.fontSize;
		const newSize = Math.max(currentSize - 1, 8); // Min font size 8
		this.updateFontSize(newSize);
	}

	/**
	 * Update terminal font size and refresh display
	 */
	updateFontSize(fontSize) {
		if (fontSize === this.terminal.options.fontSize) return;

		this.terminal.options.fontSize = fontSize;
		this.options.fontSize = fontSize;

		// Update terminal settings properly
		const currentSettings = appSettings.value.terminalSettings || {};
		const updatedSettings = { ...currentSettings, fontSize };
		appSettings.update({ terminalSettings: updatedSettings }, false);

		// Refresh terminal display
		this.terminal.refresh(0, this.terminal.rows - 1);

		// Fit terminal to container after font size change to prevent empty space
		setTimeout(() => {
			if (this.fitAddon) {
				this.fitAddon.fit();
			}
		}, 50);

		// Update touch selection cell dimensions if it exists
		if (this.touchSelection) {
			setTimeout(() => {
				this.touchSelection.updateCellDimensions();
			}, 100);
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
				await fetch(
					`http://localhost:${this.options.port}/terminals/${this.pid}/terminate`,
					{
						method: "POST",
					},
				);
			} catch {
				// Expected: terminal process may have already exited and acodex-server disconnected
			}
		}
	}

	/**
	 * Dispose terminal
	 */
	dispose() {
		this.terminate();

		// Dispose touch selection
		if (this.touchSelection) {
			this.touchSelection.destroy();
			this.touchSelection = null;
		}

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
	onProcessExit(exitData) {}
}

// Internal helpers for WebGL renderer lifecycle
TerminalComponent.prototype._handleWebglContextLoss = function () {
	try {
		console.warn("WebGL context lost; falling back to canvas renderer");
		try {
			this.webglAddon?.dispose?.();
		} catch {}
		this.webglAddon = null;
	} catch (e) {
		console.error("Error handling WebGL context loss:", e);
	}
};
