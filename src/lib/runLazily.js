/**
 * Runs/previews a file, loading the runner on first use. The runner pulls in
 * markdown-it and the markdown preview, which are not needed at startup.
 * @param {...any} args arguments for lib/run
 */
export default async function runLazily(...args) {
	const { default: run } = await import(/* webpackChunkName: "run" */ "./run");
	return run(...args);
}
