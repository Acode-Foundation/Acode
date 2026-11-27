import {
	TextDocument,
	type TextDocumentContentChangeEvent,
} from "vscode-languageserver-textdocument";
import type { Diagnostic } from "vscode-languageserver-types";
import createProgress, { type WorkDoneProgress } from "./progress";

export const METHOD_NOT_HANDLED = Symbol("method-not-handled");

type JsonRpcId = number | string | null;

interface JsonRpcMessage {
	jsonrpc?: string;
	id?: JsonRpcId;
	method?: string;
	params?: unknown;
	result?: unknown;
	error?: { message?: string };
}

interface ConfigureMessage {
	kind: "configure";
	serverId: string;
	initializationOptions?: Record<string, unknown>;
	rootUri?: string | null;
}

interface HostResponseMessage {
	kind: "host-response";
	id: number;
	result?: unknown;
	error?: string;
}

interface HostRequestMessage {
	kind: "host-request";
	id: number;
	method: "readFile" | "readDirectory";
	uri: string;
	maxBytes?: number;
}

export interface DirectoryEntry {
	name: string;
	url: string;
	isDirectory: boolean;
}

interface WorkspaceFolder {
	uri: string;
}

interface WorkspaceFoldersParams {
	event?: { added?: WorkspaceFolder[]; removed?: WorkspaceFolder[] };
}

interface InitializeParams {
	rootUri?: string | null;
	workspaceFolders?: WorkspaceFolder[] | null;
	capabilities?: { window?: { workDoneProgress?: boolean } };
}

interface WorkerScope {
	onmessage: ((event: MessageEvent<unknown>) => void) | null;
	postMessage(message: unknown): void;
	close(): void;
}

interface TextDocumentIdentifier {
	uri: string;
}

interface VersionedTextDocumentIdentifier extends TextDocumentIdentifier {
	version: number;
}

interface TextDocumentItem extends VersionedTextDocumentIdentifier {
	languageId: string;
	text: string;
}

interface DidOpenParams {
	textDocument: TextDocumentItem;
}

interface DidChangeParams {
	textDocument: VersionedTextDocumentIdentifier;
	contentChanges: TextDocumentContentChangeEvent[];
}

interface DidCloseParams {
	textDocument: TextDocumentIdentifier;
}

export interface WorkerServerContext {
	documents: Map<string, TextDocument>;
	initializationOptions?: Record<string, unknown>;
	rootUri?: string | null;
	getProjectVersion(): string;
	requestFile(uri: string, maxBytes?: number): Promise<string>;
	requestDirectory(uri: string): Promise<DirectoryEntry[]>;
	/** Re-run diagnostics for every open document. */
	revalidate(): void;
	log(level: "error" | "warn" | "info", message: string): void;
	/** Show standard LSP work-done progress in the client. */
	progress(title: string, message?: string): WorkDoneProgress;
}

export interface WorkerLanguageAdapter {
	capabilities: Record<string, unknown>;
	validate?(document: TextDocument): Diagnostic[] | PromiseLike<Diagnostic[]>;
	request(
		method: string,
		params: unknown,
	): unknown | PromiseLike<unknown> | typeof METHOD_NOT_HANDLED;
	configure?(settings: unknown): void;
	openDocument?(uri: string): void;
	closeDocument?(uri: string): void;
	addWorkspaceFolder?(uri: string): void;
	removeWorkspaceFolder?(uri: string): void;
	dispose?(): void;
}

type AdapterFactory = (
	context: WorkerServerContext,
) => WorkerLanguageAdapter | Promise<WorkerLanguageAdapter>;

const workerScope = globalThis as unknown as WorkerScope;
const documents = new Map<string, TextDocument>();
const validationTimers = new Map<string, ReturnType<typeof setTimeout>>();
const cancelledRequests = new Set<JsonRpcId>();
const hostRequests = new Map<
	number,
	{ resolve: (value: unknown) => void; reject: (error: Error) => void }
>();

const clientRequests = new Map<
	JsonRpcId,
	{ resolve: (value: unknown) => void; reject: (error: Error) => void }
>();

let adapter: WorkerLanguageAdapter | null = null;
let serverId = "worker";
let nextHostRequestId = 0;
let nextClientRequestId = 0;
let projectVersion = 0;
let supportsProgress = false;
let markClientReady: (supportsProgress: boolean) => void = () => {};
// Progress must wait for `initialized`: the client is not ready for
// server-initiated requests before then.
const clientReady = new Promise<boolean>((resolve) => {
	markClientReady = resolve;
});

function sendJson(message: unknown): void {
	workerScope.postMessage(JSON.stringify(message));
}

function sendResponse(id: JsonRpcId, result: unknown): void {
	sendJson({ jsonrpc: "2.0", id, result: result ?? null });
}

function sendError(id: JsonRpcId, code: number, error: unknown): void {
	const message = error instanceof Error ? error.message : String(error);
	sendJson({
		jsonrpc: "2.0",
		id,
		error: {
			code,
			message,
		},
	});
}

function sendNotification(method: string, params: unknown): void {
	sendJson({ jsonrpc: "2.0", method, params });
}

function requestClient(method: string, params: unknown): Promise<unknown> {
	const id = `worker-${++nextClientRequestId}`;
	return new Promise((resolve, reject) => {
		clientRequests.set(id, { resolve, reject });
		sendJson({ jsonrpc: "2.0", id, method, params });
	});
}

function handleClientResponse(message: JsonRpcMessage): void {
	const pending = message.id != null && clientRequests.get(message.id);
	if (!pending) return;
	clientRequests.delete(message.id!);
	if (message.error) pending.reject(new Error(message.error.message));
	else pending.resolve(message.result);
}

function progress(title: string, message?: string): WorkDoneProgress {
	return createProgress(
		{ ready: clientReady, request: requestClient, notify: sendNotification },
		title,
		message,
	);
}

function sendLog(level: "error" | "warn" | "info", message: string): void {
	workerScope.postMessage({ kind: "log", level, message });
}

function isConfigureMessage(value: unknown): value is ConfigureMessage {
	return (
		!!value &&
		typeof value === "object" &&
		(value as { kind?: unknown }).kind === "configure"
	);
}

function isHostResponse(value: unknown): value is HostResponseMessage {
	return (
		!!value &&
		typeof value === "object" &&
		(value as { kind?: unknown }).kind === "host-response"
	);
}

function requestHost(
	method: HostRequestMessage["method"],
	uri: string,
	maxBytes?: number,
) {
	const id = ++nextHostRequestId;
	const message: HostRequestMessage = {
		kind: "host-request",
		id,
		method,
		uri,
		maxBytes,
	};
	return new Promise((resolve, reject) => {
		hostRequests.set(id, { resolve, reject });
		workerScope.postMessage(message);
	});
}

async function requestFile(uri: string, maxBytes?: number): Promise<string> {
	return String(await requestHost("readFile", uri, maxBytes));
}

async function requestDirectory(uri: string): Promise<DirectoryEntry[]> {
	const entries = await requestHost("readDirectory", uri);
	return Array.isArray(entries) ? (entries as DirectoryEntry[]) : [];
}

function revalidate(): void {
	for (const uri of documents.keys()) scheduleValidation(uri);
}

function handleHostResponse(message: HostResponseMessage): void {
	const pending = hostRequests.get(message.id);
	if (!pending) return;
	hostRequests.delete(message.id);
	if (message.error) pending.reject(new Error(message.error));
	else pending.resolve(message.result);
}

function publishDiagnostics(
	uri: string,
	version: number,
	diagnostics: Diagnostic[],
): void {
	sendNotification("textDocument/publishDiagnostics", {
		uri,
		version,
		diagnostics,
	});
}

function scheduleValidation(uri: string): void {
	const existing = validationTimers.get(uri);
	if (existing) clearTimeout(existing);

	validationTimers.set(
		uri,
		setTimeout(async () => {
			validationTimers.delete(uri);
			const document = documents.get(uri);
			if (!document || !adapter?.validate) return;
			const version = document.version;
			try {
				const diagnostics = await adapter.validate(document);
				const current = documents.get(uri);
				if (current?.version === version) {
					publishDiagnostics(uri, version, diagnostics ?? []);
				}
			} catch (error) {
				sendLog(
					"warn",
					`Validation failed for ${uri}: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
			}
		}, 180),
	);
}

function didOpen(params: DidOpenParams): void {
	const item = params.textDocument;
	const document = TextDocument.create(
		item.uri,
		item.languageId,
		item.version,
		item.text,
	);
	documents.set(item.uri, document);
	projectVersion++;
	adapter?.openDocument?.(item.uri);
	scheduleValidation(item.uri);
}

function didChange(params: DidChangeParams): void {
	const identifier = params.textDocument;
	const document = documents.get(identifier.uri);
	if (!document) return;
	TextDocument.update(document, params.contentChanges, identifier.version);
	projectVersion++;
	scheduleValidation(identifier.uri);
}

function didClose(params: DidCloseParams): void {
	const { uri } = params.textDocument;
	const timer = validationTimers.get(uri);
	if (timer) clearTimeout(timer);
	validationTimers.delete(uri);
	if (documents.delete(uri)) projectVersion++;
	adapter?.closeDocument?.(uri);
	publishDiagnostics(uri, 0, []);
}

function initialize(params: InitializeParams | null): void {
	supportsProgress = params?.capabilities?.window?.workDoneProgress === true;
	for (const folder of params?.workspaceFolders ?? []) {
		adapter?.addWorkspaceFolder?.(folder.uri);
	}
	if (params?.rootUri) adapter?.addWorkspaceFolder?.(params.rootUri);
}

function changeWorkspaceFolders(params: WorkspaceFoldersParams | null): void {
	for (const folder of params?.event?.removed ?? []) {
		adapter?.removeWorkspaceFolder?.(folder.uri);
	}
	for (const folder of params?.event?.added ?? []) {
		adapter?.addWorkspaceFolder?.(folder.uri);
	}
}

function cancelRequest(params: unknown): void {
	const id = (params as { id?: JsonRpcId } | null)?.id;
	if (id !== undefined) cancelledRequests.add(id);
}

async function handleRequest(message: JsonRpcMessage): Promise<void> {
	const id = message.id ?? null;
	const method = message.method ?? "";

	try {
		switch (method) {
			case "initialize":
				initialize(message.params as InitializeParams | null);
				sendResponse(id, {
					capabilities: {
						textDocumentSync: {
							openClose: true,
							change: 2,
						},
						workspace: {
							workspaceFolders: {
								supported: true,
								changeNotifications: true,
							},
						},
						...(adapter?.capabilities ?? {}),
					},
					serverInfo: {
						name: `Acode built-in ${serverId} worker`,
					},
				});
				return;
			case "shutdown":
				sendResponse(id, null);
				return;
		}

		if (!adapter) {
			sendError(id, -32002, "Worker language service is not initialized");
			return;
		}

		const result = await adapter.request(method, message.params);
		if (cancelledRequests.delete(id)) {
			sendError(id, -32800, "Request cancelled");
			return;
		}
		if (result === METHOD_NOT_HANDLED) {
			sendError(id, -32601, `Method not implemented: ${method}`);
			return;
		}
		sendResponse(id, result);
	} catch (error) {
		sendError(id, -32603, error);
	}
}

function handleNotification(message: JsonRpcMessage): void {
	switch (message.method) {
		case "textDocument/didOpen":
			didOpen(message.params as DidOpenParams);
			break;
		case "textDocument/didChange":
			didChange(message.params as DidChangeParams);
			break;
		case "textDocument/didClose":
			didClose(message.params as DidCloseParams);
			break;
		case "workspace/didChangeConfiguration":
			adapter?.configure?.(
				(message.params as { settings?: unknown } | null)?.settings,
			);
			for (const uri of documents.keys()) scheduleValidation(uri);
			break;
		case "initialized":
			markClientReady(supportsProgress);
			break;
		case "workspace/didChangeWorkspaceFolders":
			changeWorkspaceFolders(message.params as WorkspaceFoldersParams | null);
			break;
		case "$/cancelRequest":
			cancelRequest(message.params);
			break;
		case "exit":
			markClientReady(false);
			adapter?.dispose?.();
			workerScope.close();
			break;
	}
}

async function handleJsonRpc(data: string): Promise<void> {
	let message: JsonRpcMessage;
	try {
		message = JSON.parse(data) as JsonRpcMessage;
	} catch {
		sendLog("warn", "Ignored an invalid JSON-RPC message");
		return;
	}

	if (!message.method) {
		handleClientResponse(message);
		return;
	}
	if (message.id !== undefined) {
		await handleRequest(message);
	} else {
		handleNotification(message);
	}
}

export function startWorkerServer(factory: AdapterFactory): void {
	workerScope.onmessage = (event: MessageEvent<unknown>) => {
		const data = event.data;
		if (isHostResponse(data)) {
			handleHostResponse(data);
			return;
		}
		if (isConfigureMessage(data)) {
			if (adapter) return;
			serverId = data.serverId;
			Promise.resolve(
				factory({
					documents,
					initializationOptions: data.initializationOptions,
					rootUri: data.rootUri,
					getProjectVersion: () => String(projectVersion),
					requestFile,
					requestDirectory,
					revalidate,
					log: sendLog,
					progress,
				}),
			).then(
				(value) => {
					adapter = value;
					workerScope.postMessage({ kind: "ready" });
				},
				(error) => {
					const message =
						error instanceof Error ? error.message : String(error);
					sendLog("error", `Failed to initialize worker: ${message}`);
					// Signal the host immediately, then shut down so we do not
					// leave a live worker waiting for the host startup timeout.
					workerScope.postMessage({ kind: "error", message });
					workerScope.close();
				},
			);
			return;
		}
		if (typeof data === "string") {
			void handleJsonRpc(data);
		}
	};
}

export function getTextDocument(
	documentsMap: Map<string, TextDocument>,
	params: unknown,
): TextDocument | null {
	const uri = (params as { textDocument?: { uri?: unknown } } | null)
		?.textDocument?.uri;
	return typeof uri === "string" ? (documentsMap.get(uri) ?? null) : null;
}

export function resolveReference(
	reference: string,
	baseUri: string,
): string | undefined {
	try {
		return new URL(reference, baseUri).href;
	} catch {
		return undefined;
	}
}
