/*
Handles worker lifecycle, readiness, logging, timeouts, disposal, RPC
message fan-out, and optional host-request dispatch so plugins do not
reimplement the same boilerplate.
*/

import { addLspLog } from "./logs";
import type { Transport, TransportHandle } from "./types";

const DEFAULT_STARTUP_TIMEOUT = 10_000;

export type LspWorkerHostHandler = (
	params: Record<string, unknown>,
) => unknown | Promise<unknown>;

export interface LspWorkerTransportOptions {
	/** Absolute or app-relative URL of the worker script. */
	url: string;
	/** Worker name (WorkerOptions.name) and default log identity. */
	name?: string;
	/** Optional id used for LSP logs and error messages. */
	serverId?: string;
	/** Milliseconds to wait for a `{ kind: "ready" }` control message. */
	startupTimeout?: number;
	/**
	 * Optional configure payload posted immediately after the worker is
	 * created. Callers typically include `kind: "configure"` plus server
	 * metadata the worker needs before it signals ready.
	 */
	configure?: Record<string, unknown>;
	/**
	 * Host-request handlers keyed by method name. Workers send
	 * `{ kind: "host-request", id, method, params? }` (or flat fields such
	 * as `uri` for built-in workers). Responses are posted back as
	 * `{ kind: "host-response", id, result?, error? }`.
	 */
	hostHandlers?: Record<string, LspWorkerHostHandler>;
}

interface WorkerControlMessage {
	kind?: string;
	id?: number;
	method?: string;
	params?: Record<string, unknown>;
	level?: "error" | "warn" | "info";
	message?: string;
	uri?: string;
	[key: string]: unknown;
}

interface WorkerHostResponse {
	kind: "host-response";
	id: number;
	result?: unknown;
	error?: string;
}

type MessageListener = (data: string) => void;

function isControlMessage(value: unknown): value is WorkerControlMessage {
	return (
		!!value &&
		typeof value === "object" &&
		"kind" in value &&
		typeof (value as { kind?: unknown }).kind === "string"
	);
}

function extractHostRequest(
	data: WorkerControlMessage,
): { id: number; method: string; params: Record<string, unknown> } | null {
	if (data.kind !== "host-request" || typeof data.id !== "number") {
		return null;
	}
	if (typeof data.method !== "string" || !data.method) {
		return null;
	}

	if (data.params && typeof data.params === "object" && !Array.isArray(data.params)) {
		return {
			id: data.id,
			method: data.method,
			params: data.params,
		};
	}

	const params: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(data)) {
		if (key === "kind" || key === "id" || key === "method" || key === "params") {
			continue;
		}
		params[key] = value;
	}
	return { id: data.id, method: data.method, params };
}

/**
 * Create a CodeMirror-compatible LSP transport backed by a Web Worker.
 *
 * The worker is expected to:
 * - signal readiness with `{ kind: "ready" }`
 * - exchange JSON-RPC as string messages
 * - optionally request host services via `{ kind: "host-request", ... }`
 * - optionally emit `{ kind: "log" | "status", ... }` control messages
 */
export function createWorkerTransport(
	options: LspWorkerTransportOptions,
): TransportHandle {
	if (!options?.url) {
		throw new Error("createWorkerTransport requires a worker url");
	}
	if (typeof Worker === "undefined") {
		throw new Error("Web Workers are not available in this environment");
	}

	const name = options.name?.trim() || "acode-lsp-worker";
	const serverId = options.serverId?.trim() || name;
	const startupTimeout =
		typeof options.startupTimeout === "number" && options.startupTimeout > 0
			? options.startupTimeout
			: DEFAULT_STARTUP_TIMEOUT;
	const hostHandlers = options.hostHandlers ?? {};

	const worker = new Worker(options.url, { name });
	const listeners = new Set<MessageListener>();
	let disposed = false;
	let readySettled = false;
	let resolveReady!: () => void;
	let rejectReady!: (error: Error) => void;

	const ready = new Promise<void>((resolve, reject) => {
		resolveReady = resolve;
		rejectReady = reject;
	});

	const startupTimer = setTimeout(() => {
		if (readySettled || disposed) return;
		readySettled = true;
		const error = new Error(
			`Timed out starting the ${serverId} worker after ${startupTimeout}ms`,
		);
		addLspLog(serverId, "error", error.message);
		worker.terminate();
		rejectReady(error);
	}, startupTimeout);

	function settleReady(error?: Error): void {
		if (readySettled) return;
		readySettled = true;
		clearTimeout(startupTimer);
		if (error) rejectReady(error);
		else resolveReady();
	}

	function dispatchToListeners(data: string): void {
		for (const listener of listeners) {
			try {
				listener(data);
			} catch (error) {
				console.error(`[LSP:${serverId}] Worker transport listener failed`, error);
			}
		}
	}

	async function handleHostRequest(message: WorkerControlMessage): Promise<void> {
		const request = extractHostRequest(message);
		if (!request) return;

		const response: WorkerHostResponse = {
			kind: "host-response",
			id: request.id,
		};

		const handler = hostHandlers[request.method];
		if (!handler) {
			response.error = `Unsupported worker host method: ${request.method}`;
		} else {
			try {
				response.result = await handler(request.params);
			} catch (error) {
				response.error =
					error instanceof Error ? error.message : String(error);
			}
		}

		if (!disposed) worker.postMessage(response);
	}

	function handleControlMessage(data: WorkerControlMessage): void {
		switch (data.kind) {
			case "ready":
				settleReady();
				addLspLog(serverId, "info", "Web Worker is ready");
				return;
			case "host-request":
				void handleHostRequest(data);
				return;
			case "log": {
				const level = data.level ?? "info";
				const message = data.message ?? "Worker message";
				addLspLog(serverId, level, message);
				console[level](`[LSP:${serverId}:worker] ${message}`);
				return;
			}
			case "status": {
				const message = data.message ?? "";
				if (message) {
					addLspLog(serverId, "info", message);
					console.info(`[LSP:${serverId}:worker] ${message}`);
				}
				return;
			}
			default:
				// Ignore unknown control frames so plugins can extend the protocol.
				return;
		}
	}

	worker.onmessage = (event: MessageEvent<unknown>) => {
		const data = event.data;
		if (typeof data === "string") {
			dispatchToListeners(data);
			return;
		}
		if (!isControlMessage(data)) return;
		handleControlMessage(data);
	};

	worker.onerror = (event: ErrorEvent) => {
		const error = new Error(
			event.message || `The ${serverId} worker failed to start`,
		);
		addLspLog(serverId, "error", error.message);
		console.error(`[LSP:${serverId}:worker]`, error);
		settleReady(error);
	};

	if (options.configure && typeof options.configure === "object") {
		worker.postMessage(options.configure);
	}

	const transport: Transport = {
		send(message: string): void {
			if (disposed) {
				throw new Error(`The ${serverId} worker is closed`);
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

export default { createTransport: createWorkerTransport };
