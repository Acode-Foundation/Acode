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
