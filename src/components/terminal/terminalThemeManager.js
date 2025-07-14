/**
 * Terminal Theme Manager
 * Manages terminal themes and provides plugin API for custom themes
 */

class TerminalThemeManager {
	constructor() {
		this.themes = {
			dark: {
				background: "#1e1e1e",
				foreground: "#ffffff",
				cursor: "#ffffff",
				cursorAccent: "#1e1e1e",
				selection: "#ffffff40",
				black: "#000000",
				red: "#cd3131",
				green: "#0dbc79",
				yellow: "#e5e510",
				blue: "#2472c8",
				magenta: "#bc3fbc",
				cyan: "#11a8cd",
				white: "#e5e5e5",
				brightBlack: "#666666",
				brightRed: "#f14c4c",
				brightGreen: "#23d18b",
				brightYellow: "#f5f543",
				brightBlue: "#3b8eea",
				brightMagenta: "#d670d6",
				brightCyan: "#29b8db",
				brightWhite: "#ffffff",
			},
			light: {
				background: "#ffffff",
				foreground: "#000000",
				cursor: "#000000",
				cursorAccent: "#ffffff",
				selection: "#00000040",
				black: "#000000",
				red: "#cd3131",
				green: "#008000",
				yellow: "#808000",
				blue: "#0000ff",
				magenta: "#800080",
				cyan: "#008080",
				white: "#c0c0c0",
				brightBlack: "#808080",
				brightRed: "#ff0000",
				brightGreen: "#00ff00",
				brightYellow: "#ffff00",
				brightBlue: "#0000ff",
				brightMagenta: "#ff00ff",
				brightCyan: "#00ffff",
				brightWhite: "#ffffff",
			},
			solarizedDark: {
				background: "#002b36",
				foreground: "#839496",
				cursor: "#839496",
				cursorAccent: "#002b36",
				selection: "#073642",
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
				selection: "#eee8d5",
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
				selection: "#49483e",
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
				selection: "#44475a",
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
				selection: "#434c5e",
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
				selection: "#665c54",
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
				selection: "#3e4451",
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
				selection: "#37474f",
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
				selection: "#33467c",
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
				selection: "#585b70",
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
				selection: "#495495",
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
				selection: "#711c91",
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
				selection: "#3a4f3a",
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
				selection: "#8b4513",
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
				selection: "#253340",
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
		};

		this.pluginThemes = new Map();
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
			...theme,
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
