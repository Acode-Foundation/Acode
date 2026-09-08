export const DEFAULT_CONSOLE_TIMEOUT = 30000;

/**
 * Runs console commands in a worker so user code can never block the page UI.
 */
export default class ConsoleExecutor {
	constructor({
		workerUrl,
		timeout = DEFAULT_CONSOLE_TIMEOUT,
		onConsole = () => {},
		WorkerClass = globalThis.Worker,
	} = {}) {
		this.workerUrl = workerUrl;
		this.timeout = timeout;
		this.onConsole = onConsole;
		this.WorkerClass = WorkerClass;
		this.worker = null;
		this.pending = null;
		this.nextId = 0;
	}

	execute(code) {
		if (this.pending) {
			return Promise.resolve({
				type: "error",
				value: new Error("Another console command is still running."),
			});
		}

		if (!this.WorkerClass) {
			return Promise.resolve({
				type: "error",
				value: new Error(
					"This WebView does not support isolated console execution.",
				),
			});
		}

		let worker;
		try {
			worker = this.getWorker();
		} catch (error) {
			return Promise.resolve({ type: "error", value: error });
		}
		const id = ++this.nextId;

		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				this.finish(id, {
					type: "error",
					value: new Error(
						`Execution stopped after ${this.timeout / 1000} seconds.`,
					),
				});
				this.resetWorker();
			}, this.timeout);

			this.pending = { id, resolve, timer };
			try {
				worker.postMessage({ id, code });
			} catch (error) {
				this.finish(id, { type: "error", value: error });
				this.resetWorker();
			}
		});
	}

	getWorker() {
		if (this.worker) return this.worker;

		const worker = new this.WorkerClass(this.workerUrl);
		worker.onmessage = ({ data }) => this.handleMessage(data);
		worker.onerror = (event) => {
			const error = new Error(event.message || "Console worker failed.");
			this.finish(this.pending?.id, { type: "error", value: error });
			this.resetWorker();
		};
		this.worker = worker;
		return worker;
	}

	handleMessage(message) {
		if (message.type === "console") {
			this.onConsole(message);
			return;
		}

		if (message.type === "result") {
			this.finish(message.id, { type: "result", value: message.value });
			return;
		}

		if (message.type === "error") {
			const error = new Error(
				message.error?.message || "Console command failed.",
			);
			error.name = message.error?.name || "Error";
			if (message.error?.stack) error.stack = message.error.stack;
			this.finish(message.id, { type: "error", value: error });
		}
	}

	finish(id, result) {
		if (!this.pending || this.pending.id !== id) return;

		const { resolve, timer } = this.pending;
		this.pending = null;
		clearTimeout(timer);
		resolve(result);
	}

	resetWorker() {
		this.worker?.terminate();
		this.worker = null;
	}

	cancel() {
		if (!this.pending) return false;

		this.finish(this.pending.id, {
			type: "error",
			value: new Error("Execution stopped."),
		});
		this.resetWorker();
		return true;
	}

	destroy() {
		if (this.pending) {
			this.finish(this.pending.id, {
				type: "error",
				value: new Error("Console execution was cancelled."),
			});
		}
		this.resetWorker();
	}
}

/**
 * Returns the actually visible browser rectangle. On mobile this shrinks with
 * the software keyboard even when the layout viewport remains full height.
 */
export function getConsoleViewportRect(windowObject = window) {
	const viewport = windowObject.visualViewport;
	const documentHeight = windowObject.document?.documentElement?.clientHeight;
	const visibleHeights = [
		viewport?.height,
		windowObject.innerHeight,
		documentHeight,
	].filter((height) => Number.isFinite(height) && height > 0);
	return {
		height: Math.round(Math.min(...visibleHeights)),
		width: Math.round(viewport?.width || windowObject.innerWidth),
		top: Math.round(viewport?.offsetTop || 0),
		left: Math.round(viewport?.offsetLeft || 0),
	};
}

export function applyConsoleViewport(element, windowObject = window) {
	const { height, width, top, left } = getConsoleViewportRect(windowObject);
	element.style.setProperty("--console-viewport-height", `${height}px`);
	element.style.setProperty("--console-viewport-width", `${width}px`);
	element.style.setProperty("--console-viewport-top", `${top}px`);
	element.style.setProperty("--console-viewport-left", `${left}px`);
}

export function resolveConsoleExecutionContext(
	isStandaloneConsole,
	selectedContext,
) {
	return isStandaloneConsole ? "worker" : selectedContext;
}

/**
 * Routes a console command to the isolated worker or the live preview page.
 * Page execution is deliberately opt-in because it runs on the preview thread.
 */
export function executeConsoleCommand({
	context,
	code,
	workerExecutor,
	pageExecutor,
}) {
	if (context === "page") return Promise.resolve(pageExecutor(code));
	return workerExecutor.execute(code);
}

/**
 * Loads a standalone JavaScript file and executes it in the isolated console
 * worker. The file is fetched first so it is never inserted as a page script.
 */
export async function executeConsoleScript({
	scriptUrl,
	workerExecutor,
	fetchScript = globalThis.fetch,
}) {
	if (!scriptUrl) return null;

	try {
		if (typeof fetchScript !== "function") {
			throw new Error("This WebView cannot load the JavaScript file.");
		}

		const response = await fetchScript(scriptUrl, { cache: "no-store" });
		if (!response.ok) {
			const status = response.status ? ` (${response.status})` : "";
			throw new Error(`Failed to load JavaScript file${status}.`);
		}

		return workerExecutor.execute(await response.text());
	} catch (error) {
		return {
			type: "error",
			value: error instanceof Error ? error : new Error(String(error)),
		};
	}
}
