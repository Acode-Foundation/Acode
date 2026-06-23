let terminalManager;
let terminalManagerPromise;

export function getLoadedTerminalManager() {
	return terminalManager;
}

export function loadTerminalManager() {
	terminalManagerPromise ??= import("./terminalManager").then((module) => {
		terminalManager = module.default;
		return terminalManager;
	});
	return terminalManagerPromise;
}
