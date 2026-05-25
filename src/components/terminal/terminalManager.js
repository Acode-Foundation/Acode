/**
 * Terminal Manager
 * Handles terminal session creation and management
 */

import EditorFile from "lib/editorFile";
import TerminalComponent from "./terminal";
import TerminalTouchSelection from "./terminalTouchSelection";
import "@xterm/xterm/css/xterm.css";
import quickTools from "components/quickTools";
import toast from "components/toast";
import alert from "dialogs/alert";
import confirm from "dialogs/confirm";
import openFile from "lib/openFile";
import openFolder from "lib/openFolder";
import appSettings from "lib/settings";
import helpers from "utils/helpers";

const TERMINAL_SESSION_STORAGE_KEY = "acodeTerminalSessions";

class TerminalManager {
	constructor() {
		this.terminals = new Map();
		this.terminalCounter = 0;
	}

	extractTerminalNumber(name) {
		if (!name) return null;
		const match = String(name).match(/^Terminal\s+(\d+)(?:\b| - )/i);
		if (!match) return null;
		const number = Number.parseInt(match[1], 10);
		return Number.isInteger(number) && number > 0 ? number : null;
	}

	getNextAvailableTerminalNumber() {
		const usedNumbers = new Set();

		for (const terminal of this.terminals.values()) {
			const number = terminal?.terminalNumber;
			if (Number.isInteger(number) && number > 0) {
				usedNumbers.add(number);
			}
		}

		let nextNumber = 1;
		while (usedNumbers.has(nextNumber)) {
			nextNumber++;
		}

		return nextNumber;
	}

	normalizePersistedSessions(stored) {
		if (!Array.isArray(stored)) {
			return {
				sessions: [],
				changed: stored != null,
			};
		}

		const sessions = [];
		const uniqueSessions = [];
		const seenPids = new Set();
		let changed = false;

		for (const entry of stored) {
			if (!entry) {
				changed = true;
				continue;
			}

			if (typeof entry === "string") {
				sessions.push({
					pid: entry,
					name: `Terminal ${entry}`,
					pinned: false,
				});
				changed = true;
				continue;
			}

			if (typeof entry !== "object" || !entry.pid) {
				changed = true;
				continue;
			}

			const pid = String(entry.pid);
			const name =
				typeof entry.name === "string" && entry.name.trim()
					? entry.name.trim()
					: `Terminal ${pid}`;
			const pinned = entry.pinned === true;

			if (entry.pid !== pid || entry.name !== name || entry.pinned !== pinned) {
				changed = true;
			}

			sessions.push({ pid, name, pinned });
		}

		for (const session of sessions) {
			const pid = String(session.pid);
			if (seenPids.has(pid)) {
				changed = true;
				continue;
			}
			seenPids.add(pid);
			uniqueSessions.push({
				pid,
				name:
					typeof session.name === "string" && session.name.trim()
						? session.name.trim()
						: `Terminal ${pid}`,
				pinned: session.pinned === true,
			});
		}

		if (uniqueSessions.length !== stored.length) {
			changed = true;
		}

		return {
			sessions: uniqueSessions,
			changed,
		};
	}

	readPersistedSessions() {
		try {
			return this.normalizePersistedSessions(
				helpers.parseJSON(localStorage.getItem(TERMINAL_SESSION_STORAGE_KEY)),
			);
		} catch (error) {
			console.error("Failed to read persisted terminal sessions:", error);
			return {
				sessions: [],
				changed: false,
			};
		}
	}

	async getPersistedSessions() {
		try {
			const { sessions, changed } = this.readPersistedSessions();
			if (!sessions.length) {
				if (changed) {
					this.savePersistedSessions([]);
				}
				return [];
			}

			if (!(await Terminal.isAxsRunning())) {
				// Once the backend is gone, previously persisted PIDs are invalid.
				this.savePersistedSessions([]);
				return [];
			}

			if (changed) {
				this.savePersistedSessions(sessions);
			}

			return sessions;
		} catch (error) {
			console.error("Failed to read persisted terminal sessions:", error);
			return [];
		}
	}

	savePersistedSessions(sessions) {
		try {
			localStorage.setItem(
				TERMINAL_SESSION_STORAGE_KEY,
				JSON.stringify(sessions),
			);
		} catch (error) {
			console.error("Failed to persist terminal sessions:", error);
		}
	}

	async persistTerminalSession(pid, name, pinned = false) {
		if (!pid) return;

		const pidStr = String(pid);
		const { sessions } = this.readPersistedSessions();
		const existingIndex = sessions.findIndex(
			(session) => session.pid === pidStr,
		);
		const sessionData = {
			pid: pidStr,
			name: name || `Terminal ${pidStr}`,
			pinned: pinned === true,
		};

		if (existingIndex >= 0) {
			sessions[existingIndex] = {
				...sessions[existingIndex],
				...sessionData,
			};
		} else {
			sessions.push(sessionData);
		}

		this.savePersistedSessions(sessions);
	}

	async removePersistedSession(pid) {
		if (!pid) return;

		const pidStr = String(pid);
		const { sessions } = this.readPersistedSessions();
		const nextSessions = sessions.filter((session) => session.pid !== pidStr);

		if (nextSessions.length !== sessions.length) {
			this.savePersistedSessions(nextSessions);
		}
	}

	async restorePersistedSessions() {
		const sessions = await this.getPersistedSessions();
		if (!sessions.length) return;

		const manager = window.editorManager;
		const activeFileId = manager?.activeFile?.id;
		const restoredTerminals = [];
		const failedSessions = [];

		for (const session of sessions) {
			if (!session?.pid) continue;
			if (this.terminals.has(session.pid)) continue;

			try {
				const instance = await this.createServerTerminal({
					pid: session.pid,
					name: session.name,
					pinned: session.pinned === true,
					reconnecting: true,
					render: false,
				});
				if (instance) restoredTerminals.push(instance);
			} catch (error) {
				console.error(
					`Failed to restore terminal session ${session.pid}:`,
					error,
				);
				failedSessions.push(session.name || session.pid);
				await this.removePersistedSession(session.pid);
			}
		}

		// Stale session entries are expected after force-closes; keep startup quiet.
		if (failedSessions.length > 0) {
			const message =
				failedSessions.length === 1
					? `Skipped unavailable terminal: ${failedSessions[0]}`
					: `Skipped ${failedSessions.length} unavailable terminals`;
			toast(message);
		}

		if (activeFileId && manager?.getFile) {
			const fileToRestore = manager.getFile(activeFileId, "id");
			fileToRestore?.makeActive();
		} else if (!manager?.activeFile && restoredTerminals.length) {
			restoredTerminals[0]?.file?.makeActive();
		}
	}

	/**
	 * Create a new terminal session
	 * @param {object} options - Terminal options
	 * @returns {Promise<object>} Terminal instance info
	 */
	async createTerminal(options = {}) {
		try {
			const { render, serverMode, reconnecting, pinned, ...terminalOptions } =
				options;
			const shouldRender = render !== false;
			const isServerMode = serverMode !== false;
			const isReconnecting = reconnecting === true;

			const terminalId = `terminal_${++this.terminalCounter}`;
			const providedName =
				typeof options.name === "string" ? options.name.trim() : "";
			const terminalNumber = providedName
				? this.extractTerminalNumber(providedName)
				: this.getNextAvailableTerminalNumber();
			const terminalName = providedName || `Terminal ${terminalNumber}`;
			const titlePrefix = terminalNumber
				? `Terminal ${terminalNumber}`
				: terminalName;

			// Check if terminal is installed before proceeding
			if (isServerMode) {
				const installationResult = await this.checkAndInstallTerminal();
				if (!installationResult.success) {
					throw new Error(installationResult.error);
				}
			}

			// Create terminal component
			const terminalComponent = new TerminalComponent({
				serverMode: isServerMode,
				...terminalOptions,
			});

			// Create container
			const terminalContainer = tag("div", {
				className: "terminal-content",
				id: `terminal-${terminalId}`,
			});

			// Terminal styles (inject once)
			if (!document.getElementById("acode-terminal-styles")) {
				const terminalStyles = this.getTerminalStyles();
				const terminalStyle = tag("style", {
					id: "acode-terminal-styles",
					textContent: terminalStyles,
				});
				document.body.appendChild(terminalStyle);
			}

			// Create EditorFile for terminal
			const terminalFile = new EditorFile(terminalName, {
				type: "terminal",
				content: terminalContainer,
				tabIcon: "icon square-terminal",
				pinned,
				render: shouldRender,
			});

			// Wait for tab creation and setup
			return await new Promise((resolve, reject) => {
				setTimeout(async () => {
					try {
						// Mount terminal component
						terminalComponent.mount(terminalContainer);

						// Connect to session if in server mode
						if (terminalComponent.serverMode) {
							await terminalComponent.connectToSession(terminalOptions.pid);
						} else {
							// For local mode, just write a welcome message
							terminalComponent.write(
								"Local terminal mode - ready for output\r\n",
							);
						}

						// Use PID as unique ID if available, otherwise fall back to terminalId
						const uniqueId = terminalComponent.pid || terminalId;

						// Setup event handlers
						this.setupTerminalHandlers(
							terminalFile,
							terminalComponent,
							uniqueId,
							titlePrefix,
						);

						const instance = {
							id: uniqueId,
							name: terminalName,
							terminalNumber,
							component: terminalComponent,
							file: terminalFile,
							container: terminalContainer,
						};

						this.terminals.set(uniqueId, instance);

						if (terminalComponent.serverMode && terminalComponent.pid) {
							await this.persistTerminalSession(
								terminalComponent.pid,
								terminalName,
								terminalFile.pinned,
							);
						}
						resolve(instance);
					} catch (error) {
						console.error("Failed to initialize terminal:", error);

						// Cleanup on failure - dispose component and remove broken tab
						try {
							terminalComponent.dispose();
						} catch (disposeError) {
							console.error(
								"Error disposing terminal component:",
								disposeError,
							);
						}

						try {
							// Force remove the tab without confirmation
							terminalFile._skipTerminalCloseConfirm = true;
							terminalFile.remove(true, { ignorePinned: true });
						} catch (removeError) {
							console.error("Error removing terminal tab:", removeError);
						}

						// Show alert for terminal creation failure
						if (!isReconnecting) {
							const errorMessage = error?.message || "Unknown error";
							alert(
								strings["error"],
								`Failed to create terminal: ${errorMessage}`,
							);
						}

						reject(error);
					}
				}, 100);
			});
		} catch (error) {
			console.error("Failed to create terminal:", error);
			throw error;
		}
	}

	/**
	 * Check if terminal is installed and install if needed
	 * @returns {Promise<{success: boolean, error?: string}>}
	 */
	async checkAndInstallTerminal() {
		try {
			// Check if terminal is already installed
			const isInstalled = await Terminal.isInstalled();
			if (isInstalled) {
				return { success: true };
			}

			// Check if terminal is supported on this device
			const isSupported = await Terminal.isSupported();
			if (!isSupported) {
				return {
					success: false,
					error: "Terminal is not supported on this device architecture",
				};
			}

			// Create installation progress terminal
			const installTerminal = await this.createInstallationTerminal();

			// Install terminal with progress logging
			const installResult = await Terminal.install(
				(message) => {
					// Remove stdout/stderr prefix for
					const cleanMessage = this.formatInstallLog(message);
					installTerminal.component.write(`${cleanMessage}\r\n`);
				},
				(...errorParts) => {
					// Remove stdout/stderr prefix
					const cleanError = this.formatInstallLog(errorParts);
					installTerminal.component.write(
						`\x1b[31mError: ${cleanError}\x1b[0m\r\n`,
					);
				},
			);

			// Only return success if Terminal.install() indicates success (exit code 0)
			if (installResult === true) {
				return { success: true };
			} else {
				const error =
					Terminal.lastInstallError ||
					"Terminal installation failed - process did not exit with code 0";
				return {
					success: false,
					error,
				};
			}
		} catch (error) {
			console.error("Terminal installation failed:", error);
			return {
				success: false,
				error: `Terminal installation failed: ${this.formatInstallLog(error)}`,
			};
		}
	}

	formatInstallLog(value) {
		const values = Array.isArray(value) ? value : [value];
		const message = values
			.filter((entry) => entry != null)
			.map((entry) => Terminal.formatError(entry))
			.filter(Boolean)
			.join(" ");

		return message.replace(/^(stdout|stderr)\s+/, "") || "Unknown error";
	}

	/**
	 * Create a terminal for showing installation progress
	 * @returns {Promise<object>} Installation terminal instance
	 */
	async createInstallationTerminal() {
		const terminalId = `install_terminal_${++this.terminalCounter}`;
		const terminalName = "Terminal Installation";

		// Create terminal component in local mode (no server needed)
		const terminalComponent = new TerminalComponent({
			serverMode: false,
		});

		// Create container
		const terminalContainer = tag("div", {
			className: "terminal-content",
			id: `terminal-${terminalId}`,
		});

		// Terminal styles (inject once)
		if (!document.getElementById("acode-terminal-styles")) {
			const terminalStyles = this.getTerminalStyles();
			const terminalStyle = tag("style", {
				id: "acode-terminal-styles",
				textContent: terminalStyles,
			});
			document.body.appendChild(terminalStyle);
		}

		// Create EditorFile for terminal
		const terminalFile = new EditorFile(terminalName, {
			type: "terminal",
			content: terminalContainer,
			tabIcon: "icon save_alt",
			render: true,
		});

		// Wait for tab creation and setup
		return await new Promise((resolve, reject) => {
			setTimeout(async () => {
				try {
					// Mount terminal component
					terminalComponent.mount(terminalContainer);

					// Write initial message
					terminalComponent.write("🚀 Installing Terminal Environment...\r\n");
					terminalComponent.write(
						"This may take a few minutes depending on your connection.\r\n\r\n",
					);

					// Setup event handlers
					this.setupTerminalHandlers(
						terminalFile,
						terminalComponent,
						terminalId,
					);

					// Set up custom title for installation terminal
					terminalFile.setCustomTitle(
						() => "Installing Terminal Environment...",
					);

					const instance = {
						id: terminalId,
						name: terminalName,
						component: terminalComponent,
						file: terminalFile,
						container: terminalContainer,
					};

					this.terminals.set(terminalId, instance);
					resolve(instance);
				} catch (error) {
					console.error("Failed to create installation terminal:", error);
					reject(error);
				}
			}, 100);
		});
	}

	/**
	 * Setup terminal event handlers
	 * @param {EditorFile} terminalFile - Terminal file instance
	 * @param {TerminalComponent} terminalComponent - Terminal component
	 * @param {string} terminalId - Terminal ID
	 */
	async setupTerminalHandlers(
		terminalFile,
		terminalComponent,
		terminalId,
		titlePrefix = terminalId,
	) {
		const textarea = terminalComponent.terminal?.textarea;
		if (textarea) {
			const onFocus = () => {
				const { $toggler } = quickTools;
				$toggler.classList.add("hide");
				clearTimeout(this.togglerTimeout);
				this.togglerTimeout = setTimeout(() => {
					$toggler.style.display = "none";
				}, 300);
			};

			const onBlur = () => {
				const { $toggler } = quickTools;
				clearTimeout(this.togglerTimeout);
				$toggler.style.display = "";
				setTimeout(() => {
					$toggler.classList.remove("hide");
				}, 10);
			};

			textarea.addEventListener("focus", onFocus);
			textarea.addEventListener("blur", onBlur);

			terminalComponent.cleanupFocusHandlers = () => {
				textarea.removeEventListener("focus", onFocus);
				textarea.removeEventListener("blur", onBlur);
			};
		}

		// Handle tab focus/blur
		terminalFile.onfocus = () => {
			// Guarded fit on focus: only fit if cols/rows would change, then focus
			const run = () => {
				try {
					const pd = terminalComponent.fitAddon?.proposeDimensions?.();
					if (
						pd &&
						(pd.cols !== terminalComponent.terminal.cols ||
							pd.rows !== terminalComponent.terminal.rows)
					) {
						terminalComponent.fitAddon.fit();
					}
				} catch {}
				terminalComponent.focus();
			};
			if (typeof requestAnimationFrame === "function") {
				requestAnimationFrame(run);
			} else {
				setTimeout(run, 0);
			}
		};

		// Handle tab close
		terminalFile.onclose = () => {
			this.closeTerminal(terminalId);
		};
		terminalFile.onpinstatechange = (pinned) => {
			if (!terminalComponent.serverMode || !terminalComponent.pid) return;
			void this.persistTerminalSession(
				terminalComponent.pid,
				terminalFile.filename,
				pinned,
			);
		};

		terminalFile._skipTerminalCloseConfirm = false;
		const originalRemove = terminalFile.remove.bind(terminalFile);
		terminalFile.remove = async (force = false, options = {}) => {
			if (terminalFile.pinned && !options?.ignorePinned) {
				return originalRemove(force, options);
			}

			if (
				!terminalFile._skipTerminalCloseConfirm &&
				this.shouldConfirmTerminalClose()
			) {
				const message = `${strings["close"]} ${strings["terminal"]}?`;
				const shouldClose = await confirm(strings["confirm"], message);
				if (!shouldClose) return;
			}

			terminalFile._skipTerminalCloseConfirm = false;
			return originalRemove(force, options);
		};

		// Enhanced resize handling with debouncing
		let resizeTimeout = null;
		const RESIZE_DEBOUNCE = 200;
		let lastResizeTime = 0;

		let lastWidth = 0;
		let lastHeight = 0;
		const handleResize = (entries) => {
			const now = Date.now();
			const entry = entries && entries[0];
			const cr = entry?.contentRect;
			const width = cr?.width ?? terminalFile.content?.clientWidth ?? 0;
			const height = cr?.height ?? terminalFile.content?.clientHeight ?? 0;

			// Clear any pending resize
			if (resizeTimeout) {
				clearTimeout(resizeTimeout);
			}

			// Debounce rapid resize events (common during keyboard open/close)
			resizeTimeout = setTimeout(() => {
				try {
					// Check if terminal is still available and mounted
					if (!terminalComponent.terminal || !terminalComponent.container) {
						return;
					}

					// Only fit if actual size changed to reduce reflows
					if (
						Math.abs(width - lastWidth) > 0.5 ||
						Math.abs(height - lastHeight) > 0.5
					) {
						terminalComponent.fit();
						lastWidth = width;
						lastHeight = height;
					}

					// Update last resize time
					lastResizeTime = now;
				} catch (error) {
					console.error(`Resize error for terminal ${terminalId}:`, error);
				}
			}, RESIZE_DEBOUNCE);
		};

		const resizeObserver =
			typeof ResizeObserver === "function"
				? new ResizeObserver(handleResize)
				: null;
		let resizeFallbackInterval = null;

		// Wait for the terminal container to be available, then observe it
		setTimeout(() => {
			const containerElement = terminalFile.content;
			if (containerElement && containerElement instanceof Element) {
				if (resizeObserver) {
					resizeObserver.observe(containerElement);
					// store observer so we can disconnect on close
					terminalFile._resizeObserver = resizeObserver;
				} else {
					resizeFallbackInterval = setInterval(() => handleResize(), 500);
					terminalFile._resizeObserver = {
						disconnect() {
							clearInterval(resizeFallbackInterval);
						},
					};
				}
			} else {
				console.warn("Terminal container not available for ResizeObserver");
			}
		}, 200);

		// Terminal event handlers
		terminalComponent.onConnect = () => {
			console.log(`Terminal ${terminalId} connected`);
		};

		terminalComponent.onDisconnect = () => {
			console.log(`Terminal ${terminalId} disconnected`);
		};

		terminalComponent.onError = (error) => {
			console.error(`Terminal ${terminalId} error:`, error);

			// Close the terminal and remove the tab
			this.closeTerminal(terminalId, true);

			// Show alert for connection error
			const errorMessage = error?.message || "Connection lost";
			alert(strings["error"], `Terminal connection error: ${errorMessage}`);
		};

		terminalComponent.onTitleChange = async (title) => {
			if (title) {
				// Keep the tab prefix stable for this terminal instance.
				const formattedTitle = `${titlePrefix} - ${title}`;
				terminalFile.filename = formattedTitle;

				if (terminalComponent.serverMode && terminalComponent.pid) {
					await this.persistTerminalSession(
						terminalComponent.pid,
						formattedTitle,
						terminalFile.pinned,
					);
				}

				// Refresh the header subtitle if this terminal is active
				if (
					editorManager.activeFile &&
					editorManager.activeFile.id === terminalFile.id
				) {
					// Force refresh of the header subtitle
					terminalFile.setCustomTitle(getTerminalTitle);
				}
			}
		};

		terminalComponent.onProcessExit = (exitData) => {
			// Format exit message based on exit code and signal
			let message;
			if (exitData.signal) {
				message = `Process terminated by signal ${exitData.signal}`;
			} else if (exitData.exit_code === 0) {
				message = `Process exited successfully (code ${exitData.exit_code})`;
			} else {
				message = `Process exited with code ${exitData.exit_code}`;
			}

			this.closeTerminal(terminalId);
			terminalFile._skipTerminalCloseConfirm = true;
			terminalFile.remove(true, { ignorePinned: true });
			toast(message);
		};

		// Handle acode CLI open commands (OSC 7777)
		terminalComponent.onOscOpen = async (type, path) => {
			if (!path) return;

			// Convert proot path
			const fileUri = this.convertProotPath(path);
			// Extract folder/file name from normalized path
			const name = this.getPathDisplayName(path);

			try {
				if (type === "folder") {
					// Open folder in sidebar
					await openFolder(fileUri, { name, saveState: true, listFiles: true });
					toast(`Opened folder: ${name}`);
				} else {
					// Open file in editor
					await openFile(fileUri, { render: true });
				}
			} catch (error) {
				console.error("Failed to open from terminal:", error);
				toast(`Failed to open: ${path}`);
			}
		};

		// Store references for cleanup
		terminalFile._terminalId = terminalId;
		terminalFile.terminalComponent = terminalComponent;
		terminalFile._resizeObserver = resizeObserver;

		// Set up custom title function for terminal
		const getTerminalTitle = () => {
			if (terminalComponent.pid) {
				return `PID: ${terminalComponent.pid}`;
			}
			// fallback to terminal name
			return `${terminalId}`;
		};

		terminalFile.setCustomTitle(getTerminalTitle);
	}

	/**
	 * Close a terminal session
	 * @param {string} terminalId - Terminal ID
	 */
	closeTerminal(terminalId, removeTab = false) {
		const terminal = this.terminals.get(terminalId);
		if (!terminal) return;

		try {
			if (terminal.component.serverMode && terminal.component.pid) {
				this.removePersistedSession(terminal.component.pid);
			}

			// Cleanup resize observer
			if (terminal.file._resizeObserver) {
				terminal.file._resizeObserver.disconnect();
				terminal.file._resizeObserver = null;
			}

			// Cleanup focus handlers
			if (terminal.component.cleanupFocusHandlers) {
				terminal.component.cleanupFocusHandlers();
			}

			// Dispose terminal component
			terminal.component.dispose();

			// Remove from map
			this.terminals.delete(terminalId);

			// Optionally remove the tab as well
			if (removeTab && terminal.file) {
				try {
					terminal.file._skipTerminalCloseConfirm = true;
					terminal.file.remove(true, { ignorePinned: true });
				} catch (removeError) {
					console.error("Error removing terminal tab:", removeError);
				}
			}

			if (this.getAllTerminals().size <= 0) {
				Executor.stopService();
			}

			console.log(`Terminal ${terminalId} closed`);
		} catch (error) {
			console.error(`Error closing terminal ${terminalId}:`, error);
		}
	}

	/**
	 * Get terminal by ID
	 * @param {string} terminalId - Terminal ID
	 * @returns {object|null} Terminal instance
	 */
	getTerminal(terminalId) {
		return this.terminals.get(terminalId) || null;
	}

	/**
	 * Get all active terminals
	 * @returns {Map} All terminals
	 */
	getAllTerminals() {
		return this.terminals;
	}

	/**
	 * Register a touch-selection "More" menu option.
	 * @param {object} option
	 * @returns {string|null}
	 */
	addTouchSelectionMoreOption(option) {
		return TerminalTouchSelection.addMoreOption(option);
	}

	/**
	 * Remove a touch-selection "More" menu option.
	 * @param {string} id
	 * @returns {boolean}
	 */
	removeTouchSelectionMoreOption(id) {
		return TerminalTouchSelection.removeMoreOption(id);
	}

	/**
	 * List touch-selection "More" menu options.
	 * @returns {Array<object>}
	 */
	getTouchSelectionMoreOptions() {
		return TerminalTouchSelection.getMoreOptions();
	}

	/**
	 * Write to a specific terminal
	 * @param {string} terminalId - Terminal ID
	 * @param {string} data - Data to write
	 */
	writeToTerminal(terminalId, data) {
		const terminal = this.getTerminal(terminalId);
		if (terminal) {
			terminal.component.write(data);
		}
	}

	/**
	 * Clear a specific terminal
	 * @param {string} terminalId - Terminal ID
	 */
	clearTerminal(terminalId) {
		const terminal = this.getTerminal(terminalId);
		if (terminal) {
			terminal.component.clear();
		}
	}

	/**
	 * Get terminal styles for shadow DOM
	 * @returns {string} CSS styles
	 */
	getTerminalStyles() {
		return `
			.terminal-content {
				width: 100%;
				height: 100%;
				box-sizing: border-box;
				background: #1e1e1e;
				overflow: hidden;
				position: relative;
			}

			.terminal-content .xterm {
				padding: 0.25rem;
				box-sizing: border-box;
			}
		`;
	}

	/**
	 * Create a local terminal (no server connection)
	 * @param {object} options - Terminal options
	 * @returns {Promise<object>} Terminal instance
	 */
	async createLocalTerminal(options = {}) {
		return this.createTerminal({
			...options,
			serverMode: false,
		});
	}

	/**
	 * Create a server terminal (with backend connection)
	 * @param {object} options - Terminal options
	 * @returns {Promise<object>} Terminal instance
	 */
	async createServerTerminal(options = {}) {
		return this.createTerminal({
			...options,
			serverMode: true,
		});
	}

	/**
	 * Handle keyboard resize events for all terminals
	 * This is called when the virtual keyboard opens/closes on mobile
	 */
	handleKeyboardResize() {
		// Add a small delay to let the UI settle
		setTimeout(() => {
			this.terminals.forEach((terminal) => {
				try {
					if (terminal.component && terminal.component.terminal) {
						// Force a re-fit for all terminals
						terminal.component.fit();

						// If terminal has lots of content, try to preserve scroll position
						const buffer = terminal.component.terminal.buffer?.active;
						if (
							buffer &&
							buffer.length > terminal.component.terminal.rows * 2
						) {
							// For content-heavy terminals, ensure we stay near the bottom if we were there
							const wasNearBottom =
								buffer.viewportY >=
								buffer.length - terminal.component.terminal.rows - 5;
							if (wasNearBottom) {
								// Scroll to bottom after resize
								setTimeout(() => {
									terminal.component.terminal.scrollToBottom();
								}, 100);
							}
						}
					}
				} catch (error) {
					console.error(
						`Error handling keyboard resize for terminal ${terminal.id}:`,
						error,
					);
				}
			});
		}, 150);
	}

	/**
	 * Stabilize terminal viewport after resize operations
	 */
	stabilizeTerminals() {
		this.terminals.forEach((terminal) => {
			try {
				if (terminal.component && terminal.component.terminal) {
					// Clear any touch selections during stabilization
					if (
						terminal.component.touchSelection &&
						terminal.component.touchSelection.isSelecting
					) {
						terminal.component.touchSelection.clearSelection();
					}

					// Re-fit and refresh
					terminal.component.fit();

					// Focus the active terminal to ensure proper state
					if (terminal.file && terminal.file.isOpen) {
						setTimeout(() => {
							terminal.component.focus();
						}, 50);
					}
				}
			} catch (error) {
				console.error(`Error stabilizing terminal ${terminal.id}:`, error);
			}
		});
	}

	/**
	 * Convert proot internal path to app-accessible path
	 * @param {string} prootPath - Path from inside proot environment
	 * @returns {string} App filesystem path
	 */
	convertProotPath(prootPath) {
		if (!prootPath) return prootPath;

		const packageName = window.BuildInfo?.packageName || "com.foxdebug.acode";
		const dataDir = `/data/user/0/${packageName}`;
		const alpineRoot = `${dataDir}/files/alpine`;

		let convertedPath;

		if (prootPath.startsWith("/public")) {
			// /public -> /data/user/0/com.foxdebug.acode/files/public
			convertedPath = `file://${dataDir}/files${prootPath}`;
		} else if (
			prootPath.startsWith("/sdcard") ||
			prootPath.startsWith("/storage") ||
			prootPath.startsWith("/data")
		) {
			convertedPath = `file://${prootPath}`;
		} else if (prootPath.startsWith("/")) {
			// Everything else is relative to alpine root
			convertedPath = `file://${alpineRoot}${prootPath}`;
		} else {
			convertedPath = prootPath;
		}

		//console.log(`Path conversion: ${prootPath} -> ${convertedPath}`);
		return convertedPath;
	}

	/**
	 * Get a stable display name from a filesystem path.
	 * Handles trailing "." and ".." segments (e.g. "/a/b/." -> "b").
	 * @param {string} path
	 * @returns {string}
	 */
	getPathDisplayName(path) {
		if (!path) return "folder";

		const normalized = [];
		for (const segment of String(path).split("/")) {
			if (!segment || segment === ".") continue;
			if (segment === "..") {
				if (normalized.length) normalized.pop();
				continue;
			}
			normalized.push(segment);
		}

		return normalized.pop() || "folder";
	}

	shouldConfirmTerminalClose() {
		const settings = appSettings?.value?.terminalSettings;
		if (settings && settings.confirmTabClose === false) {
			return false;
		}
		return true;
	}
}

// Create singleton instance
const terminalManager = new TerminalManager();

export default terminalManager;
