import appSettings from "lib/settings";

export const DEFAULT_TERMINAL_SETTINGS = {
	fontSize: 12,
	fontFamily: "MesloLGS NF Regular",
	fontWeight: "normal",
	cursorBlink: true,
	cursorStyle: "block",
	cursorInactiveStyle: "outline",
	scrollback: 1000,
	theme: "dark",
	tabStopWidth: 4,
	convertEol: true,
	letterSpacing: 0,
	imageSupport: false,
	fontLigatures: false,
	// Touch selection settings
	touchSelectionTapHoldDuration: 600,
	touchSelectionMoveThreshold: 8,
	touchSelectionHandleSize: 24,
	touchSelectionHapticFeedback: true,
	touchSelectionShowContextMenu: true,
};

export function getTerminalSettings() {
	const settings = appSettings.value.terminalSettings || {};
	return {
		...DEFAULT_TERMINAL_SETTINGS,
		...settings,
	};
}
