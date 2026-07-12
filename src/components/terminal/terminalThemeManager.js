/**
 * Terminal Theme Manager
 * Manages terminal themes and provides plugin API for custom themes
 */

class TerminalThemeManager {
	constructor() {
		this.themes = {
			dark: {
				background: "#23272a",
				foreground: "#f5f5f5",
				cursor: "#4285f4",
				cursorAccent: "#23272a",
				selectionBackground: "#ffffff40",
				selectionForeground: "#f5f5f5",
				selectionInactiveBackground: "#ffffff40",
				scrollbarSliderBackground: "#f5f5f533",
				scrollbarSliderHoverBackground: "#f5f5f566",
				scrollbarSliderActiveBackground: "#f5f5f580",
				overviewRulerBorder: "#2d3134",
				black: "#181b1e",
				red: "#f07178",
				green: "#c3e88d",
				yellow: "#ffcb6b",
				blue: "#4285f4",
				magenta: "#c792ea",
				cyan: "#89ddff",
				white: "#f5f5f5",
				brightBlack: "#2d3134",
				brightRed: "#ff6b6b",
				brightGreen: "#5af78e",
				brightYellow: "#f4f99d",
				brightBlue: "#82aaff",
				brightMagenta: "#c594c5",
				brightCyan: "#9aedfe",
				brightWhite: "#ffffff",
			},
			light: {
				background: "#ffffff",
				foreground: "#0f1729",
				cursor: "#3b82f6",
				cursorAccent: "#ffffff",
				selectionBackground: "#cbd5e1",
				selectionForeground: "#0f1729",
				selectionInactiveBackground: "#cbd5e1",
				scrollbarSliderBackground: "#0f172933",
				scrollbarSliderHoverBackground: "#0f172966",
				scrollbarSliderActiveBackground: "#0f172980",
				overviewRulerBorder: "#475569",
				black: "#1e293b",
				red: "#dc2626",
				green: "#16a34a",
				yellow: "#ca8a04",
				blue: "#3b82f6",
				magenta: "#9333ea",
				cyan: "#0891b2",
				white: "#64748b",
				brightBlack: "#475569",
				brightRed: "#ef4444",
				brightGreen: "#22c55e",
				brightYellow: "#eab308",
				brightBlue: "#6366f1",
				brightMagenta: "#a855f7",
				brightCyan: "#06b6d4",
				brightWhite: "#0f1729",
			},
			solarizedDark: {
				background: "#002b36",
				foreground: "#839496",
				cursor: "#839496",
				cursorAccent: "#002b36",
				selectionBackground: "#073642",
				selectionForeground: "#839496",
				selectionInactiveBackground: "#073642",
				scrollbarSliderBackground: "#83949633",
				scrollbarSliderHoverBackground: "#83949666",
				scrollbarSliderActiveBackground: "#83949680",
				overviewRulerBorder: "#002b36",
				black: "#073642",
				red: "#dc322f",
				green: "#859900",
				yellow: "#b58900",
				blue: "#268bd2",
				magenta: "#d33682",
				cyan: "#2aa198",
				white: "#eee8d5",
				brightBlack: "#002b36",
				brightRed: "#cb4b16",
				brightGreen: "#586e75",
				brightYellow: "#657b83",
				brightBlue: "#839496",
				brightMagenta: "#6c71c4",
				brightCyan: "#93a1a1",
				brightWhite: "#fdf6e3",
			},
			solarizedLight: {
				background: "#fdf6e3",
				foreground: "#657b83",
				cursor: "#657b83",
				cursorAccent: "#fdf6e3",
				selectionBackground: "#d6cda9",
				selectionForeground: "#657b83",
				selectionInactiveBackground: "#d6cda9",
				scrollbarSliderBackground: "#657b8333",
				scrollbarSliderHoverBackground: "#657b8366",
				scrollbarSliderActiveBackground: "#657b8380",
				overviewRulerBorder: "#002b36",
				black: "#073642",
				red: "#dc322f",
				green: "#859900",
				yellow: "#b58900",
				blue: "#268bd2",
				magenta: "#d33682",
				cyan: "#2aa198",
				white: "#eee8d5",
				brightBlack: "#002b36",
				brightRed: "#cb4b16",
				brightGreen: "#586e75",
				brightYellow: "#657b83",
				brightBlue: "#839496",
				brightMagenta: "#6c71c4",
				brightCyan: "#93a1a1",
				brightWhite: "#fdf6e3",
			},
			monokai: {
				background: "#272822",
				foreground: "#f8f8f2",
				cursor: "#f8f8f0",
				cursorAccent: "#272822",
				selectionBackground: "#49483e",
				selectionForeground: "#f8f8f2",
				selectionInactiveBackground: "#49483e",
				scrollbarSliderBackground: "#f8f8f233",
				scrollbarSliderHoverBackground: "#f8f8f266",
				scrollbarSliderActiveBackground: "#f8f8f280",
				overviewRulerBorder: "#75715e",
				black: "#272822",
				red: "#f92672",
				green: "#a6e22e",
				yellow: "#e6db74",
				blue: "#66d9ef",
				magenta: "#ae81ff",
				cyan: "#a1efe4",
				white: "#f8f8f2",
				brightBlack: "#75715e",
				brightRed: "#ff6188",
				brightGreen: "#a6e22e",
				brightYellow: "#ffd866",
				brightBlue: "#78dce8",
				brightMagenta: "#ab9df2",
				brightCyan: "#a1efe4",
				brightWhite: "#f9f8f5",
			},
			dracula: {
				background: "#282a36",
				foreground: "#f8f8f2",
				cursor: "#f8f8f0",
				cursorAccent: "#282a36",
				selectionBackground: "#44475a",
				selectionForeground: "#f8f8f2",
				selectionInactiveBackground: "#44475a",
				scrollbarSliderBackground: "#f8f8f233",
				scrollbarSliderHoverBackground: "#f8f8f266",
				scrollbarSliderActiveBackground: "#f8f8f280",
				overviewRulerBorder: "#4d4d4d",
				black: "#000000",
				red: "#ff5555",
				green: "#50fa7b",
				yellow: "#f1fa8c",
				blue: "#bd93f9",
				magenta: "#ff79c6",
				cyan: "#8be9fd",
				white: "#bfbfbf",
				brightBlack: "#4d4d4d",
				brightRed: "#ff6e67",
				brightGreen: "#5af78e",
				brightYellow: "#f4f99d",
				brightBlue: "#caa9fa",
				brightMagenta: "#ff92d0",
				brightCyan: "#9aedfe",
				brightWhite: "#e6e6e6",
			},
			nord: {
				background: "#2e3440",
				foreground: "#d8dee9",
				cursor: "#d8dee9",
				cursorAccent: "#2e3440",
				selectionBackground: "#434c5e",
				selectionForeground: "#d8dee9",
				selectionInactiveBackground: "#434c5e",
				scrollbarSliderBackground: "#d8dee933",
				scrollbarSliderHoverBackground: "#d8dee966",
				scrollbarSliderActiveBackground: "#d8dee980",
				overviewRulerBorder: "#4c566a",
				black: "#3b4252",
				red: "#bf616a",
				green: "#a3be8c",
				yellow: "#ebcb8b",
				blue: "#81a1c1",
				magenta: "#b48ead",
				cyan: "#88c0d0",
				white: "#e5e9f0",
				brightBlack: "#4c566a",
				brightRed: "#d08770",
				brightGreen: "#a3be8c",
				brightYellow: "#ebcb8b",
				brightBlue: "#5e81ac",
				brightMagenta: "#b48ead",
				brightCyan: "#8fbcbb",
				brightWhite: "#eceff4",
			},
			gruvbox: {
				background: "#282828",
				foreground: "#ebdbb2",
				cursor: "#ebdbb2",
				cursorAccent: "#282828",
				selectionBackground: "#665c54",
				selectionForeground: "#ebdbb2",
				selectionInactiveBackground: "#665c54",
				scrollbarSliderBackground: "#ebdbb233",
				scrollbarSliderHoverBackground: "#ebdbb266",
				scrollbarSliderActiveBackground: "#ebdbb280",
				overviewRulerBorder: "#928374",
				black: "#282828",
				red: "#cc241d",
				green: "#98971a",
				yellow: "#d79921",
				blue: "#458588",
				magenta: "#b16286",
				cyan: "#689d6a",
				white: "#a89984",
				brightBlack: "#928374",
				brightRed: "#fb4934",
				brightGreen: "#b8bb26",
				brightYellow: "#fabd2f",
				brightBlue: "#83a598",
				brightMagenta: "#d3869b",
				brightCyan: "#8ec07c",
				brightWhite: "#ebdbb2",
			},
			oneDark: {
				background: "#21252b",
				foreground: "#abb2bf",
				cursor: "#528bff",
				cursorAccent: "#21252b",
				selectionBackground: "#3e4451",
				selectionForeground: "#abb2bf",
				selectionInactiveBackground: "#3e4451",
				scrollbarSliderBackground: "#abb2bf33",
				scrollbarSliderHoverBackground: "#abb2bf66",
				scrollbarSliderActiveBackground: "#abb2bf80",
				overviewRulerBorder: "#5c6370",
				black: "#21252b",
				red: "#e86671",
				green: "#98c379",
				yellow: "#e5c07b",
				blue: "#61afef",
				magenta: "#c678dd",
				cyan: "#56b6c2",
				white: "#abb2bf",
				brightBlack: "#5c6370",
				brightRed: "#f07178",
				brightGreen: "#a6e22e",
				brightYellow: "#f9e79f",
				brightBlue: "#73d0ff",
				brightMagenta: "#d19a66",
				brightCyan: "#7fdbca",
				brightWhite: "#ffffff",
			},
			material: {
				background: "#263238",
				foreground: "#eeffff",
				cursor: "#ffcc00",
				cursorAccent: "#263238",
				selectionBackground: "#37474f",
				selectionForeground: "#eeffff",
				selectionInactiveBackground: "#37474f",
				scrollbarSliderBackground: "#eeffff33",
				scrollbarSliderHoverBackground: "#eeffff66",
				scrollbarSliderActiveBackground: "#eeffff80",
				overviewRulerBorder: "#546e7a",
				black: "#263238",
				red: "#f07178",
				green: "#c3e88d",
				yellow: "#ffcb6b",
				blue: "#82aaff",
				magenta: "#c792ea",
				cyan: "#89ddff",
				white: "#eeffff",
				brightBlack: "#546e7a",
				brightRed: "#f07178",
				brightGreen: "#c3e88d",
				brightYellow: "#ffcb6b",
				brightBlue: "#82aaff",
				brightMagenta: "#c792ea",
				brightCyan: "#89ddff",
				brightWhite: "#ffffff",
			},
			tokyoNight: {
				background: "#1a1b26",
				foreground: "#c0caf5",
				cursor: "#c0caf5",
				cursorAccent: "#1a1b26",
				selectionBackground: "#33467c",
				selectionForeground: "#c0caf5",
				selectionInactiveBackground: "#33467c",
				scrollbarSliderBackground: "#c0caf533",
				scrollbarSliderHoverBackground: "#c0caf566",
				scrollbarSliderActiveBackground: "#c0caf580",
				overviewRulerBorder: "#414868",
				black: "#15161e",
				red: "#f7768e",
				green: "#9ece6a",
				yellow: "#e0af68",
				blue: "#7aa2f7",
				magenta: "#bb9af7",
				cyan: "#7dcfff",
				white: "#a9b1d6",
				brightBlack: "#414868",
				brightRed: "#f7768e",
				brightGreen: "#9ece6a",
				brightYellow: "#e0af68",
				brightBlue: "#7aa2f7",
				brightMagenta: "#bb9af7",
				brightCyan: "#7dcfff",
				brightWhite: "#c0caf5",
			},
			catppuccin: {
				background: "#1e1e2e",
				foreground: "#cdd6f4",
				cursor: "#f5e0dc",
				cursorAccent: "#1e1e2e",
				selectionBackground: "#585b70",
				selectionForeground: "#cdd6f4",
				selectionInactiveBackground: "#585b70",
				scrollbarSliderBackground: "#cdd6f433",
				scrollbarSliderHoverBackground: "#cdd6f466",
				scrollbarSliderActiveBackground: "#cdd6f480",
				overviewRulerBorder: "#585b70",
				black: "#45475a",
				red: "#f38ba8",
				green: "#a6e3a1",
				yellow: "#f9e2af",
				blue: "#89b4fa",
				magenta: "#f5c2e7",
				cyan: "#94e2d5",
				white: "#bac2de",
				brightBlack: "#585b70",
				brightRed: "#f38ba8",
				brightGreen: "#a6e3a1",
				brightYellow: "#f9e2af",
				brightBlue: "#89b4fa",
				brightMagenta: "#f5c2e7",
				brightCyan: "#94e2d5",
				brightWhite: "#a6adc8",
			},
			synthwave: {
				background: "#241b2f",
				foreground: "#f92aad",
				cursor: "#f4f99d",
				cursorAccent: "#241b2f",
				selectionBackground: "#495495",
				selectionForeground: "#f92aad",
				selectionInactiveBackground: "#495495",
				scrollbarSliderBackground: "#f92aad33",
				scrollbarSliderHoverBackground: "#f92aad66",
				scrollbarSliderActiveBackground: "#f92aad80",
				overviewRulerBorder: "#495495",
				black: "#241b2f",
				red: "#ff8b94",
				green: "#a8e6cf",
				yellow: "#f4f99d",
				blue: "#88d8c0",
				magenta: "#ff8b94",
				cyan: "#88d8c0",
				white: "#f92aad",
				brightBlack: "#495495",
				brightRed: "#ff8b94",
				brightGreen: "#a8e6cf",
				brightYellow: "#f4f99d",
				brightBlue: "#88d8c0",
				brightMagenta: "#ff8b94",
				brightCyan: "#88d8c0",
				brightWhite: "#f92aad",
			},
			cyberpunk: {
				background: "#000b1e",
				foreground: "#0abdc6",
				cursor: "#ea00d9",
				cursorAccent: "#000b1e",
				selectionBackground: "#711c91",
				selectionForeground: "#0abdc6",
				selectionInactiveBackground: "#711c91",
				scrollbarSliderBackground: "#0abdc633",
				scrollbarSliderHoverBackground: "#0abdc666",
				scrollbarSliderActiveBackground: "#0abdc680",
				overviewRulerBorder: "#133e7c",
				black: "#000b1e",
				red: "#ff0040",
				green: "#00ff41",
				yellow: "#ffff00",
				blue: "#0080ff",
				magenta: "#ea00d9",
				cyan: "#0abdc6",
				white: "#ffffff",
				brightBlack: "#133e7c",
				brightRed: "#ff0040",
				brightGreen: "#00ff41",
				brightYellow: "#ffff00",
				brightBlue: "#0080ff",
				brightMagenta: "#ea00d9",
				brightCyan: "#0abdc6",
				brightWhite: "#ffffff",
			},
			forest: {
				background: "#1b2b1b",
				foreground: "#d4ddd4",
				cursor: "#87ceeb",
				cursorAccent: "#1b2b1b",
				selectionBackground: "#3a4f3a",
				selectionForeground: "#d4ddd4",
				selectionInactiveBackground: "#3a4f3a",
				scrollbarSliderBackground: "#d4ddd433",
				scrollbarSliderHoverBackground: "#d4ddd466",
				scrollbarSliderActiveBackground: "#d4ddd480",
				overviewRulerBorder: "#5f6f5f",
				black: "#1b2b1b",
				red: "#d75f5f",
				green: "#87af87",
				yellow: "#d7af5f",
				blue: "#87ceeb",
				magenta: "#af87af",
				cyan: "#5fafaf",
				white: "#d4ddd4",
				brightBlack: "#5f6f5f",
				brightRed: "#d75f5f",
				brightGreen: "#87af87",
				brightYellow: "#d7af5f",
				brightBlue: "#87ceeb",
				brightMagenta: "#af87af",
				brightCyan: "#5fafaf",
				brightWhite: "#ffffff",
			},
			sunset: {
				background: "#3c1f1f",
				foreground: "#ffd5a5",
				cursor: "#ff8c42",
				cursorAccent: "#3c1f1f",
				selectionBackground: "#8b4513",
				selectionForeground: "#ffd5a5",
				selectionInactiveBackground: "#8b4513",
				scrollbarSliderBackground: "#ffd5a533",
				scrollbarSliderHoverBackground: "#ffd5a566",
				scrollbarSliderActiveBackground: "#ffd5a580",
				overviewRulerBorder: "#8b4513",
				black: "#3c1f1f",
				red: "#ff6b6b",
				green: "#ffa500",
				yellow: "#ffd700",
				blue: "#ff8c42",
				magenta: "#ff69b4",
				cyan: "#ffa500",
				white: "#ffd5a5",
				brightBlack: "#8b4513",
				brightRed: "#ff6b6b",
				brightGreen: "#ffa500",
				brightYellow: "#ffd700",
				brightBlue: "#ff8c42",
				brightMagenta: "#ff69b4",
				brightCyan: "#ffa500",
				brightWhite: "#fff8dc",
			},
			ocean: {
				background: "#0f1419",
				foreground: "#e6e1cf",
				cursor: "#f29718",
				cursorAccent: "#0f1419",
				selectionBackground: "#253340",
				selectionForeground: "#e6e1cf",
				selectionInactiveBackground: "#253340",
				scrollbarSliderBackground: "#e6e1cf33",
				scrollbarSliderHoverBackground: "#e6e1cf66",
				scrollbarSliderActiveBackground: "#e6e1cf80",
				overviewRulerBorder: "#4d5566",
				black: "#0f1419",
				red: "#ff3333",
				green: "#b8cc52",
				yellow: "#e7c547",
				blue: "#36a3d9",
				magenta: "#f07178",
				cyan: "#95e6cb",
				white: "#ffffff",
				brightBlack: "#4d5566",
				brightRed: "#ff3333",
				brightGreen: "#b8cc52",
				brightYellow: "#e7c547",
				brightBlue: "#36a3d9",
				brightMagenta: "#f07178",
				brightCyan: "#95e6cb",
				brightWhite: "#ffffff",
			},
			glass: {
				background: "#ffffff",
				foreground: "#111827",
				cursor: "#6366f1",
				cursorAccent: "#ffffff",
				selectionBackground: "#c7d2fe",
				selectionForeground: "#111827",
				selectionInactiveBackground: "#c7d2fe",
				scrollbarSliderBackground: "#11182733",
				scrollbarSliderHoverBackground: "#11182766",
				scrollbarSliderActiveBackground: "#11182780",
				overviewRulerBorder: "#4b5563",
				black: "#374151",
				red: "#dc2626",
				green: "#16a34a",
				yellow: "#ca8a04",
				blue: "#6366f1",
				magenta: "#9333ea",
				cyan: "#0891b2",
				white: "#6b7280",
				brightBlack: "#4b5563",
				brightRed: "#ef4444",
				brightGreen: "#22c55e",
				brightYellow: "#eab308",
				brightBlue: "#8b5cf6",
				brightMagenta: "#a855f7",
				brightCyan: "#06b6d4",
				brightWhite: "#111827",
			},
			glassDark: {
				background: "#181820",
				foreground: "#e5e7eb",
				cursor: "#6366f1",
				cursorAccent: "#181820",
				selectionBackground: "#374151",
				selectionForeground: "#e5e7eb",
				selectionInactiveBackground: "#374151",
				scrollbarSliderBackground: "#e5e7eb33",
				scrollbarSliderHoverBackground: "#e5e7eb66",
				scrollbarSliderActiveBackground: "#e5e7eb80",
				overviewRulerBorder: "#1f1f2a",
				black: "#0f0f14",
				red: "#f87171",
				green: "#4ade80",
				yellow: "#fbbf24",
				blue: "#6366f1",
				magenta: "#a78bfa",
				cyan: "#22d3ee",
				white: "#e5e7eb",
				brightBlack: "#1f1f2a",
				brightRed: "#fca5a5",
				brightGreen: "#86efac",
				brightYellow: "#fcd34d",
				brightBlue: "#818cf8",
				brightMagenta: "#c4b5fd",
				brightCyan: "#67e8f9",
				brightWhite: "#f3f4f6",
			},
		};

		this.pluginThemes = new Map();
	}

	/**
	 * Normalize the renamed selection field in legacy plugin themes.
	 * @param {object} theme - Theme object
	 * @returns {object} Normalized theme object
	 */
	normalizeTheme(theme) {
		const normalized = { ...theme };

		// Keep third-party themes written for older xterm.js versions working.
		if (!normalized.selectionBackground && normalized.selection) {
			normalized.selectionBackground = normalized.selection;
		}
		delete normalized.selection;

		return normalized;
	}

	/**
	 * Get a theme by name
	 * @param {string} themeName - Theme name
	 * @returns {object} Theme object
	 */
	getTheme(themeName) {
		// Check plugin themes first
		if (this.pluginThemes.has(themeName)) {
			return this.pluginThemes.get(themeName);
		}

		// Check built-in themes
		return this.themes[themeName] || this.themes.dark;
	}

	/**
	 * Get all available themes
	 * @returns {object} All themes
	 */
	getAllThemes() {
		const allThemes = { ...this.themes };

		// Add plugin themes
		for (const [name, theme] of this.pluginThemes) {
			allThemes[name] = theme;
		}

		return allThemes;
	}

	/**
	 * Get all theme names
	 * @returns {string[]} Array of theme names
	 */
	getThemeNames() {
		return Object.keys(this.getAllThemes());
	}

	/**
	 * Register a plugin theme
	 * @param {string} name - Theme name
	 * @param {object} theme - Theme object
	 * @param {string} pluginId - Plugin ID for cleanup
	 */
	registerTheme(name, theme, pluginId) {
		if (this.themes[name]) {
			console.warn(
				`Terminal theme '${name}' conflicts with built-in theme. Use a different name.`,
			);
			return false;
		}

		// Validate theme structure
		if (!this.validateTheme(theme)) {
			console.error(`Invalid terminal theme '${name}':`, theme);
			return false;
		}

		// Store theme with plugin metadata
		this.pluginThemes.set(name, {
			...this.normalizeTheme(theme),
			_pluginId: pluginId,
			_isPlugin: true,
		});

		console.log(`Terminal theme '${name}' registered by plugin ${pluginId}`);
		return true;
	}

	/**
	 * Unregister a plugin theme
	 * @param {string} name - Theme name
	 * @param {string} pluginId - Plugin ID for verification
	 */
	unregisterTheme(name, pluginId) {
		const theme = this.pluginThemes.get(name);

		if (!theme) {
			console.warn(`Terminal theme '${name}' not found`);
			return false;
		}

		if (theme._pluginId !== pluginId) {
			console.warn(
				`Terminal theme '${name}' was not registered by plugin ${pluginId}`,
			);
			return false;
		}

		this.pluginThemes.delete(name);
		console.log(`Terminal theme '${name}' unregistered`);
		return true;
	}

	/**
	 * Unregister all themes from a plugin
	 * @param {string} pluginId - Plugin ID
	 */
	unregisterPluginThemes(pluginId) {
		const themesToRemove = [];

		for (const [name, theme] of this.pluginThemes) {
			if (theme._pluginId === pluginId) {
				themesToRemove.push(name);
			}
		}

		themesToRemove.forEach((name) => {
			this.pluginThemes.delete(name);
		});

		if (themesToRemove.length > 0) {
			console.log(
				`Unregistered ${themesToRemove.length} terminal themes from plugin ${pluginId}`,
			);
		}
	}

	/**
	 * Validate theme structure
	 * @param {object} theme - Theme object to validate
	 * @returns {boolean} True if valid
	 */
	validateTheme(theme) {
		const requiredColors = [
			"background",
			"foreground",
			"cursor",
			"black",
			"red",
			"green",
			"yellow",
			"blue",
			"magenta",
			"cyan",
			"white",
			"brightBlack",
			"brightRed",
			"brightGreen",
			"brightYellow",
			"brightBlue",
			"brightMagenta",
			"brightCyan",
			"brightWhite",
		];

		if (!theme || typeof theme !== "object") {
			return false;
		}

		// Check required colors
		for (const color of requiredColors) {
			if (!theme[color] || typeof theme[color] !== "string") {
				console.warn(`Terminal theme missing or invalid color: ${color}`);
				return false;
			}
		}

		return true;
	}

	/**
	 * Create a theme variant based on existing theme
	 * @param {string} baseName - Base theme name
	 * @param {object} overrides - Color overrides
	 * @returns {object} New theme object
	 */
	createVariant(baseName, overrides) {
		const baseTheme = this.getTheme(baseName);
		return { ...baseTheme, ...overrides };
	}
}

// Create singleton instance
const terminalThemeManager = new TerminalThemeManager();

export default terminalThemeManager;
