import type { TextDocument } from "vscode-languageserver-textdocument";

interface HostRequest {
	kind: "host-request";
	id: number;
	method: "readFile";
	uri: string;
}

interface PendingRequest {
	resolve(value: unknown): void;
	reject(error: Error): void;
}

export class NestedLspClient {
	private readonly worker: Worker;
	private readonly pending = new Map<number, PendingRequest>();
	private readonly versions = new Map<string, number>();
	private nextRequestId = 0;
	private ready: Promise<void>;
	/** Set when the worker fails or is disposed; new requests fail immediately. */
	private closedError: Error | null = null;

	constructor(
		url: string,
		config: {
			serverId: string;
			rootUri?: string | null;
			initializationOptions?: Record<string, unknown>;
		},
		private readonly requestFile: (uri: string) => Promise<string>,
	) {
		this.worker = new Worker(url, {
			name: `acode-embedded-${config.serverId}-lsp`,
		});
		this.ready = new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => {
				const error = new Error(
					`Timed out starting ${config.serverId} worker`,
				);
				this.fail(error);
				reject(error);
			}, 10000);
			this.worker.onmessage = (event: MessageEvent<unknown>) => {
				const data = event.data;
				if (data && typeof data === "object") {
					const kind = (data as { kind?: unknown }).kind;
					if (kind === "ready") {
						clearTimeout(timeout);
						resolve();
						return;
					}
					if (kind === "error") {
						clearTimeout(timeout);
						const message =
							typeof (data as { message?: unknown }).message === "string"
								? (data as { message: string }).message
								: "Nested worker failed";
						const error = new Error(message);
						this.fail(error);
						reject(error);
						return;
					}
				}
				void this.handleMessage(data);
			};
			this.worker.onerror = (event) => {
				clearTimeout(timeout);
				const error = new Error(event.message || "Nested worker failed");
				this.fail(error);
				reject(error);
			};
		}).then(async () => {
			if (this.closedError) throw this.closedError;
			await this.requestRaw("initialize", {
				processId: null,
				rootUri: config.rootUri ?? null,
				capabilities: {},
			});
			this.notify("initialized", {});
		});
		this.worker.postMessage({ kind: "configure", ...config });
	}

	async syncDocument(document: TextDocument): Promise<void> {
		await this.ready;
		this.throwIfClosed();
		const previousVersion = this.versions.get(document.uri);
		if (previousVersion === document.version) return;
		if (previousVersion === undefined) {
			this.notify("textDocument/didOpen", {
				textDocument: {
					uri: document.uri,
					languageId: document.languageId,
					version: document.version,
					text: document.getText(),
				},
			});
		} else {
			this.notify("textDocument/didChange", {
				textDocument: {
					uri: document.uri,
					version: document.version,
				},
				contentChanges: [{ text: document.getText() }],
			});
		}
		this.versions.set(document.uri, document.version);
	}

	async request(
		method: string,
		params: unknown,
		document?: TextDocument,
	): Promise<unknown> {
		await this.ready;
		this.throwIfClosed();
		if (document) await this.syncDocument(document);
		return this.requestRaw(method, params);
	}

	closeDocument(uri: string): void {
		if (!this.versions.delete(uri)) return;
		if (this.closedError) return;
		this.notify("textDocument/didClose", {
			textDocument: { uri },
		});
	}

	dispose(): void {
		this.fail(new Error("Nested worker disposed"));
		this.versions.clear();
		this.worker.terminate();
	}

	private throwIfClosed(): void {
		if (this.closedError) throw this.closedError;
	}

	/**
	 * Marks the client dead, rejects every in-flight request, and blocks new ones.
	 * Safe to call multiple times (e.g. onerror after ready, then dispose).
	 */
	private fail(error: Error): void {
		if (this.closedError) return;
		this.closedError = error;
		for (const request of this.pending.values()) {
			request.reject(error);
		}
		this.pending.clear();
	}

	private requestRaw(method: string, params: unknown): Promise<unknown> {
		if (this.closedError) return Promise.reject(this.closedError);
		const id = ++this.nextRequestId;
		return new Promise((resolve, reject) => {
			if (this.closedError) {
				reject(this.closedError);
				return;
			}
			this.pending.set(id, { resolve, reject });
			this.worker.postMessage(
				JSON.stringify({ jsonrpc: "2.0", id, method, params }),
			);
		});
	}

	private notify(method: string, params: unknown): void {
		if (this.closedError) return;
		this.worker.postMessage(JSON.stringify({ jsonrpc: "2.0", method, params }));
	}

	private async handleMessage(data: unknown): Promise<void> {
		if (typeof data === "string") {
			const message = JSON.parse(data) as {
				id?: number;
				result?: unknown;
				error?: { message?: string };
			};
			if (typeof message.id !== "number") return;
			const request = this.pending.get(message.id);
			if (!request) return;
			this.pending.delete(message.id);
			if (message.error) {
				request.reject(new Error(message.error.message || "Nested request failed"));
			} else {
				request.resolve(message.result);
			}
			return;
		}

		if (this.closedError) return;

		const hostRequest = data as HostRequest | null;
		if (
			!hostRequest ||
			hostRequest.kind !== "host-request" ||
			hostRequest.method !== "readFile"
		) {
			return;
		}
		try {
			const result = await this.requestFile(hostRequest.uri);
			if (this.closedError) return;
			this.worker.postMessage({
				kind: "host-response",
				id: hostRequest.id,
				result,
			});
		} catch (error) {
			if (this.closedError) return;
			this.worker.postMessage({
				kind: "host-response",
				id: hostRequest.id,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
}
