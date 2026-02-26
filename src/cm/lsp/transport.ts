/*
	Language servers that expose stdio are proxied through a lightweight
	WebSocket bridge so the CodeMirror client can continue to speak WebSocket.
*/

import type { Transport } from "@codemirror/lsp-client";
import type {
	LspServerDefinition,
	TransportContext,
	TransportHandle,
	WebSocketTransportOptions,
} from "./types";

const DEFAULT_TIMEOUT = 5000;
const RECONNECT_BASE_DELAY = 500;
const RECONNECT_MAX_DELAY = 10000;
const RECONNECT_MAX_ATTEMPTS = 5;

type MessageListener = (data: string) => void;

interface TransportInterface extends Transport {
	send(message: string): void;
	subscribe(handler: MessageListener): void;
	unsubscribe(handler: MessageListener): void;
}

function createWebSocketTransport(
	server: LspServerDefinition,
	context: TransportContext,
): TransportHandle {
	const transport = server.transport;
	if (!transport) {
		throw new Error(
			`LSP server ${server.id} is missing transport configuration`,
		);
	}

	let url = transport.url;
	const options: WebSocketTransportOptions = transport.options ?? {};

	// Use dynamic port from auto-port discovery if available
	if (context.dynamicPort && context.dynamicPort > 0) {
		url = `ws://127.0.0.1:${context.dynamicPort}/`;
		console.info(
			`[LSP:${server.id}] Using auto-discovered port ${context.dynamicPort}`,
		);
	}

	// URL is only required when not using dynamic port
	if (!url) {
		throw new Error(
			`WebSocket transport for ${server.id} has no URL (and no dynamic port available)`,
		);
	}

	// Store validated URL in a const for TypeScript narrowing in nested functions
	const wsUrl: string = url;

	const listeners = new Set<MessageListener>();
	const binaryMode = !!options.binary;
	const timeout = options.timeout ?? DEFAULT_TIMEOUT;
	const enableReconnect = options.reconnect !== false;
	const maxReconnectAttempts =
		options.maxReconnectAttempts ?? RECONNECT_MAX_ATTEMPTS;

	let socket: WebSocket | null = null;
	let disposed = false;
	let reconnectAttempts = 0;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	let connected = false;

	const encoder = binaryMode ? new TextEncoder() : null;

	function createSocket(): WebSocket {
		try {
			// pylsp's websocket endpoint does not require subprotocol negotiation.
			// Avoid passing protocols to keep the handshake simple.
			const ws = new WebSocket(wsUrl);
			if (binaryMode) {
				ws.binaryType = "arraybuffer";
			}
			return ws;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(
				`Failed to construct WebSocket for ${server.id} (${wsUrl}): ${message}`,
			);
		}
	}

	function handleMessage(event: MessageEvent): void {
		let data: string;
		if (typeof event.data === "string") {
			data = event.data;
		} else if (event.data instanceof Blob) {
			// Handle Blob synchronously by queuing - avoids async ordering issues
			event.data
				.text()
				.then((text: string) => {
					dispatchToListeners(text);
				})
				.catch((err: Error) => {
					console.error("Failed to read Blob message", err);
				});
			return;
		} else if (event.data instanceof ArrayBuffer) {
			data = new TextDecoder().decode(event.data);
		} else {
			console.warn(
				"Unknown WebSocket message type",
				typeof event.data,
				event.data,
			);
			data = String(event.data);
		}
		dispatchToListeners(data);
	}

	function dispatchToListeners(data: string): void {
		// Debugging aid while stabilising websocket transport
		if (context?.debugWebSocket) {
			console.debug(`[LSP:${server.id}] <=`, data);
		}

		// Temporary fix
		// Intercept server requests that the CodeMirror LSP client doesn't handle
		// The client only handles notifications, but some servers (e.g., TypeScript)
		// send requests like window/workDoneProgress/create that need a response
		try {
			const msg = JSON.parse(data);
			if (
				msg &&
				typeof msg.id !== "undefined" &&
				msg.method === "window/workDoneProgress/create"
			) {
				// This is a request, respond with success
				const response = JSON.stringify({
					jsonrpc: "2.0",
					id: msg.id,
					result: null,
				});
				if (context?.debugWebSocket) {
					console.debug(`[LSP:${server.id}] => (auto-response)`, response);
				}
				if (socket && socket.readyState === WebSocket.OPEN) {
					if (binaryMode && encoder) {
						socket.send(encoder.encode(response));
					} else {
						socket.send(response);
					}
				}
				// Don't pass this request to listeners since we handled it
				console.info(
					`[LSP:${server.id}] Auto-responded to window/workDoneProgress/create`,
				);
				return;
			}
		} catch (_) {
			// Not valid JSON or missing fields, pass through normally
		}

		listeners.forEach((listener) => {
			try {
				listener(data);
			} catch (error) {
				console.error("LSP transport listener failed", error);
			}
		});
	}

	function handleClose(event: CloseEvent): void {
		connected = false;
		if (disposed) return;

		const wasClean = event.wasClean || event.code === 1000;
		if (wasClean) {
			console.info(`[LSP:${server.id}] WebSocket closed cleanly`);
			return;
		}

		console.warn(
			`[LSP:${server.id}] WebSocket closed unexpectedly (code: ${event.code})`,
		);

		if (enableReconnect && reconnectAttempts < maxReconnectAttempts) {
			scheduleReconnect();
		} else if (reconnectAttempts >= maxReconnectAttempts) {
			console.error(`[LSP:${server.id}] Max reconnection attempts reached`);
		}
	}

	function handleError(event: Event): void {
		if (disposed) return;
		const errorEvent = event as ErrorEvent;
		const reason =
			errorEvent?.message || errorEvent?.type || "connection error";
		console.error(`[LSP:${server.id}] WebSocket error: ${reason}`);
	}

	function scheduleReconnect(): void {
		if (disposed || reconnectTimer) return;

		const delay = Math.min(
			RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts),
			RECONNECT_MAX_DELAY,
		);
		reconnectAttempts++;

		console.info(
			`[LSP:${server.id}] Reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${maxReconnectAttempts})`,
		);

		reconnectTimer = setTimeout(() => {
			reconnectTimer = null;
			if (disposed) return;
			attemptReconnect();
		}, delay);
	}

	function attemptReconnect(): void {
		if (disposed) return;

		try {
			socket = createSocket();
			setupSocketHandlers(socket);

			socket.onopen = () => {
				connected = true;
				reconnectAttempts = 0;
				console.info(`[LSP:${server.id}] Reconnected successfully`);
				if (socket) {
					socket.onopen = null;
				}
			};
		} catch (error) {
			console.error(`[LSP:${server.id}] Reconnection failed`, error);
			if (reconnectAttempts < maxReconnectAttempts) {
				scheduleReconnect();
			}
		}
	}

	function setupSocketHandlers(ws: WebSocket): void {
		ws.onmessage = handleMessage;
		ws.onclose = handleClose;
		ws.onerror = handleError;
	}

	// Initial socket creation
	socket = createSocket();

	const ready = new Promise<void>((resolve, reject) => {
		const timeoutId = setTimeout(() => {
			if (socket) {
				socket.onopen = null;
				socket.onerror = null;
			}
			try {
				socket?.close();
			} catch (_) {
				// Ignore close errors
			}
			reject(new Error(`Timed out opening WebSocket for ${server.id}`));
		}, timeout);

		if (socket) {
			socket.onopen = () => {
				clearTimeout(timeoutId);
				connected = true;
				if (socket) {
					setupSocketHandlers(socket);
				}
				resolve();
			};

			socket.onerror = (event: Event) => {
				clearTimeout(timeoutId);
				if (socket) {
					socket.onopen = null;
					socket.onerror = null;
				}
				const errorEvent = event as ErrorEvent;
				const reason =
					errorEvent?.message || errorEvent?.type || "connection error";
				reject(new Error(`WebSocket error for ${server.id}: ${reason}`));
			};
		}
	});

	const transportInterface: TransportInterface = {
		send(message: string): void {
			if (!connected || !socket || socket.readyState !== WebSocket.OPEN) {
				throw new Error("WebSocket transport is not open");
			}
			if (binaryMode && encoder) {
				socket.send(encoder.encode(message));
			} else {
				socket.send(message);
			}
		},
		subscribe(handler: MessageListener): void {
			listeners.add(handler);
		},
		unsubscribe(handler: MessageListener): void {
			listeners.delete(handler);
		},
	};

	const dispose = (): void => {
		disposed = true;
		connected = false;

		if (reconnectTimer) {
			clearTimeout(reconnectTimer);
			reconnectTimer = null;
		}

		listeners.clear();

		if (socket) {
			if (
				socket.readyState === WebSocket.CLOSED ||
				socket.readyState === WebSocket.CLOSING
			) {
				return;
			}
			try {
				socket.close(1000, "Client disposed");
			} catch (_) {
				// Ignore close errors
			}
		}
	};

	return { transport: transportInterface, dispose, ready };
}

function createStdioTransport(
	server: LspServerDefinition,
	context: TransportContext,
): TransportHandle {
	if (!server.transport) {
		throw new Error(
			`LSP server ${server.id} is missing transport configuration`,
		);
	}
	if (!server.transport.url) {
		throw new Error(
			`STDIO transport for ${server.id} is missing a websocket bridge url`,
		);
	}
	if (!server.transport.options?.binary) {
		console.info(
			`LSP server ${server.id} is using stdio bridge without binary mode. Falling back to text frames.`,
		);
	}
	return createWebSocketTransport(server, context);
}

export function createTransport(
	server: LspServerDefinition,
	context: TransportContext = {},
): TransportHandle {
	if (!server) {
		throw new Error("createTransport requires a server configuration");
	}
	if (!server.transport) {
		throw new Error(
			`LSP server ${server.id || "unknown"} is missing transport configuration`,
		);
	}

	const kind = server.transport.kind;
	if (!kind) {
		throw new Error(
			`LSP server ${server.id} transport is missing 'kind' property`,
		);
	}

	switch (kind) {
		case "websocket":
			return createWebSocketTransport(server, context);
		case "stdio":
			return createStdioTransport(server, context);
		case "external":
			if (typeof server.transport.create === "function") {
				return server.transport.create(server, context);
			}
			throw new Error(
				`LSP server ${server.id} declares an external transport without a create() factory`,
			);
		default:
			throw new Error(`Unsupported transport kind: ${kind}`);
	}
}

export default { createTransport };
