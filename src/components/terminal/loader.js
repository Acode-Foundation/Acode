/**
 * Loads the terminal manager (and xterm) on demand so it stays out of the
 * startup bundle.
 */

/** @type {import("./terminalManager").default | null} */
let manager = null;
/** @type {Promise<import("./terminalManager").default> | null} */
let loading = null;

/**
 * The terminal manager if it has already been loaded, otherwise null.
 */
export function getLoadedTerminalManager() {
	return manager;
}

/**
 * Loads the terminal manager, reusing the pending load if one is in flight.
 * @returns {Promise<import("./terminalManager").default>}
 */
export function loadTerminalManager() {
	loading ??= import(
		/* webpackChunkName: "terminal" */ "./terminalManager"
	).then(
		({ default: terminalManager }) => {
			manager = terminalManager;
			return terminalManager;
		},
		(error) => {
			loading = null;
			throw error;
		},
	);
	return loading;
}
