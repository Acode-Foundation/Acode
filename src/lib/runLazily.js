/**
 * Runs/previews the active file, loading the runner on first use. The runner
 * pulls in markdown-it and the markdown preview, which are not needed at
 * startup.
 * @param {boolean} [isConsole]
 * @param {"inapp"|"browser"} [target]
 * @param {boolean} [runFile]
 */
export default async function runLazily(isConsole, target, runFile) {
	// Capture the file now: the user may switch tabs while the runner loads.
	const file = isConsole ? null : editorManager.activeFile;
	const { default: run } = await import(/* webpackChunkName: "run" */ "./run");
	return run(isConsole, target, runFile, file);
}
