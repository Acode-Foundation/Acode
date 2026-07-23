import { addLspLog } from "../logs";
import type {
	InstallCheckResult,
	LspRuntimeProvider,
	LspServerDefinition,
	Transport,
	TransportContext,
	TransportHandle,
} from "../types";

export const WEB_WORKER_RUNTIME_ID = "web-worker";

const SUPPORTED_SERVERS = new Set(["html", "css", "json", "typescript"]);
const WORKER_URLS: Record<string, string> = {
	html: "build/htmlLspWorker.js",
	css: "build/cssLspWorker.js",
	json: "build/jsonLspWorker.js",
	typescript: "build/typescriptLspWorker.js",
};
const STARTUP_TIMEOUT = 10000;

interface WorkerControlMessage {
	kind: "ready" | "host-request" | "log";
	id?: number;
	level?: "error" | "warn" | "info";
	message?: string;
	method?: "readFile";
	uri?: string;
}

interface WorkerHostResponse {
	kind: "host-response";
	id: number;
	result?: unknown;
	error?: string;
}

type MessageListener = (data: string) => void;

const bundledStatus: InstallCheckResult = {
	status: "present",
	version: "bundled",
	canInstall: false,
	canUpdate: false,
	message: "Built into Acode and runs offline in a Web Worker.",
};

async function fileSystemRequest(
	method: NonNullable<WorkerControlMessage["method"]>,
	uri: string,
): Promise<unknown> {
	const { default: fsOperation } = await import("fileSystem");
	const fs = fsOperation(uri);
	if (!fs) throw new Error(`No filesystem provider can handle ${uri}`);
	return (await fs.readFile("utf-8")) as string;
}

function isControlMessage(value: unknown): value is WorkerControlMessage {
	return (
		!!value &&
		typeof value === "object" &&
		"kind" in value &&
		typeof (value as { kind?: unknown }).kind === "string"
	);
}

function createWorkerTransport(
	server: LspServerDefinition,
	context: TransportContext,
): TransportHandle {
	const workerUrl = WORKER_URLS[server.id];
	if (!workerUrl) {
		throw new Error(`No built-in worker is available for ${server.id}`);
	}
	const worker = new Worker(workerUrl, {
		name: `acode-${server.id}-lsp`,
	});
	const listeners = new Set<MessageListener>();
	let disposed = false;
	let readySettled = false;
	let resolveReady: () => void;
	let rejectReady: (error: Error) => void;

	const ready = new Promise<void>((resolve, reject) => {
		resolveReady = resolve;
		rejectReady = reject;
	});

	const startupTimer = setTimeout(() => {
		if (readySettled || disposed) return;
		readySettled = true;
		rejectReady(
			new Error(`Timed out starting the built-in ${server.label} worker`),
		);
		worker.terminate();
	}, server.startupTimeout ?? STARTUP_TIMEOUT);

	function settleReady(error?: Error): void {
		if (readySettled) return;
		readySettled = true;
		clearTimeout(startupTimer);
		if (error) rejectReady(error);
		else resolveReady();
	}

	async function handleHostRequest(message: WorkerControlMessage): Promise<void> {
		const id = message.id;
		if (typeof id !== "number" || !message.method || !message.uri) {
			return;
		}

		const response: WorkerHostResponse = {
			kind: "host-response",
			id,
		};
		try {
			response.result = await fileSystemRequest(message.method, message.uri);
		} catch (error) {
			response.error = error instanceof Error ? error.message : String(error);
		}
		if (!disposed) worker.postMessage(response);
	}

	worker.onmessage = (event: MessageEvent<unknown>) => {
		const data = event.data;
		if (typeof data === "string") {
			for (const listener of listeners) {
				try {
					listener(data);
				} catch (error) {
					console.error("Worker LSP transport listener failed", error);
				}
			}
			return;
		}

		if (!isControlMessage(data)) return;
		switch (data.kind) {
			case "ready":
				settleReady();
				addLspLog(server.id, "info", "Built-in Web Worker is ready");
				break;
			case "host-request":
				void handleHostRequest(data);
				break;
			case "log": {
				const level = data.level ?? "info";
				const message = data.message ?? "Worker message";
				addLspLog(server.id, level, message);
				console[level](`[LSP:${server.id}:worker] ${message}`);
				break;
			}
		}
	};

	worker.onerror = (event: ErrorEvent) => {
		const error = new Error(
			event.message || `The built-in ${server.label} worker failed`,
		);
		addLspLog(server.id, "error", error.message);
		settleReady(error);
	};

	worker.postMessage({
		kind: "configure",
		serverId: server.id,
		initializationOptions: server.initializationOptions,
		rootUri: context.originalRootUri ?? context.rootUri,
	});

	const transport: Transport = {
		send(message: string): void {
			if (disposed) {
				throw new Error(`The built-in ${server.label} worker is closed`);
			}
			worker.postMessage(message);
		},
		subscribe(handler: MessageListener): void {
			listeners.add(handler);
		},
		unsubscribe(handler: MessageListener): void {
			listeners.delete(handler);
		},
	};

	return {
		transport,
		ready,
		dispose(): void {
			if (disposed) return;
			disposed = true;
			clearTimeout(startupTimer);
			listeners.clear();
			worker.terminate();
		},
	};
}

export const webWorkerRuntimeProvider: LspRuntimeProvider = {
	id: WEB_WORKER_RUNTIME_ID,
	label: "Built-in Web Worker",
	priority: 100,

	canHandle(server) {
		return SUPPORTED_SERVERS.has(server.id) && typeof Worker !== "undefined";
	},

	resolveUris(_server, context) {
		return {
			documentUri: context.originalDocumentUri,
			rootUri: context.originalRootUri,
			scope: "workspace",
		};
	},

	async checkInstallation() {
		return bundledStatus;
	},

	getInstallCommand() {
		return null;
	},

	getUninstallCommand() {
		return null;
	},

	async start(server, context) {
		return {
			kind: "transport",
			providerId: WEB_WORKER_RUNTIME_ID,
			transport: createWorkerTransport(server, context),
		};
	},
};

export default webWorkerRuntimeProvider;
