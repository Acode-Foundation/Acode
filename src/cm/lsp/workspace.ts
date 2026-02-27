import type { WorkspaceFile } from "@codemirror/lsp-client";
import { LSPPlugin, Workspace } from "@codemirror/lsp-client";
import type { Text, TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { getModeForPath } from "cm/modelist";
import type { WorkspaceFileUpdate, WorkspaceOptions } from "./types";

class AcodeWorkspaceFile implements WorkspaceFile {
	uri: string;
	languageId: string;
	version: number;
	doc: Text;
	views: Set<EditorView>;

	constructor(
		uri: string,
		languageId: string,
		version: number,
		doc: Text,
		view?: EditorView,
	) {
		this.uri = uri;
		this.languageId = languageId;
		this.version = version;
		this.doc = doc;
		this.views = new Set();
		if (view) this.views.add(view);
	}

	getView(preferred?: EditorView): EditorView | null {
		if (preferred && this.views.has(preferred)) return preferred;
		const iterator = this.views.values();
		const next = iterator.next();
		return next.done ? null : next.value;
	}
}

export default class AcodeWorkspace extends Workspace {
	files: AcodeWorkspaceFile[];
	options: WorkspaceOptions;

	#fileMap: Map<string, AcodeWorkspaceFile>;
	#versions: Record<string, number>;
	#workspaceFolders: Set<string>;

	constructor(
		client: ConstructorParameters<typeof Workspace>[0],
		options: WorkspaceOptions = {},
	) {
		super(client);
		this.files = [];
		this.#fileMap = new Map();
		this.#versions = Object.create(null) as Record<string, number>;
		this.#workspaceFolders = new Set();
		this.options = options;
	}

	#getOrCreateFile(
		uri: string,
		languageId: string,
		view: EditorView,
	): AcodeWorkspaceFile {
		let file = this.#fileMap.get(uri);
		if (!file) {
			const doc = view.state?.doc;
			if (!doc) {
				throw new Error(
					`Cannot create workspace file without document: ${uri}`,
				);
			}
			file = new AcodeWorkspaceFile(
				uri,
				languageId,
				this.#nextFileVersion(uri),
				doc,
				view,
			);
			this.#fileMap.set(uri, file);
			this.files.push(file);
			this.client.didOpen(file);
		}
		file.views.add(view);
		return file;
	}

	#getFileEntry(uri: string): AcodeWorkspaceFile | null {
		return this.#fileMap.get(uri) ?? null;
	}

	#removeFileEntry(file: AcodeWorkspaceFile): void {
		this.#fileMap.delete(file.uri);
		this.files = this.files.filter((candidate) => candidate !== file);
	}

	#nextFileVersion(uri: string): number {
		const current = this.#versions[uri] ?? -1;
		const next = current + 1;
		this.#versions[uri] = next;
		return next;
	}

	#resolveLanguageIdForUri(uri: string): string {
		if (typeof this.options.resolveLanguageId === "function") {
			const resolved = this.options.resolveLanguageId(uri);
			if (resolved) return resolved;
		}
		try {
			const mode = getModeForPath(uri);
			if (mode?.name) {
				return String(mode.name).toLowerCase();
			}
		} catch (error) {
			console.warn(
				`[LSP:Workspace] Failed to resolve language id for ${uri}`,
				error,
			);
		}
		return "plaintext";
	}

	syncFiles(): readonly WorkspaceFileUpdate[] {
		const updates: WorkspaceFileUpdate[] = [];
		for (const file of this.files) {
			const view = file.getView();
			if (!view) continue;
			const plugin = LSPPlugin.get(view);
			if (!plugin) continue;
			const { unsyncedChanges } = plugin;
			if (unsyncedChanges.empty) continue;

			updates.push({ file, prevDoc: file.doc, changes: unsyncedChanges });
			file.doc = view.state.doc;
			file.version = this.#nextFileVersion(file.uri);
			plugin.clear();
		}
		return updates;
	}

	openFile(uri: string, languageId: string, view: EditorView): void {
		if (!view) return;
		this.#getOrCreateFile(uri, languageId, view);
	}

	closeFile(uri: string, view?: EditorView): void {
		const file = this.#getFileEntry(uri);
		if (!file) return;

		if (view && file.views.has(view)) {
			file.views.delete(view);
		}

		if (!file.views.size) {
			this.client.didClose(uri);
			this.#removeFileEntry(file);
		}
	}

	getFile(uri: string): AcodeWorkspaceFile | null {
		return this.#getFileEntry(uri);
	}

	requestFile(uri: string): Promise<AcodeWorkspaceFile | null> {
		return Promise.resolve(this.#getFileEntry(uri));
	}

	connected(): void {
		for (const file of this.files) {
			this.client.didOpen(file);
		}
	}

	updateFile(uri: string, update: TransactionSpec): void {
		const file = this.#getFileEntry(uri);

		if (file) {
			const view = file.getView();
			if (view) {
				view.dispatch(update);
				return;
			}
		}

		// File is not open - try to open it and apply the update
		this.#applyUpdateToClosedFile(uri, update).catch((error) => {
			console.warn(`[LSP:Workspace] Failed to apply update: ${uri}`, error);
		});
	}

	async #applyUpdateToClosedFile(
		uri: string,
		update: TransactionSpec,
	): Promise<void> {
		if (typeof this.options.displayFile !== "function") return;

		try {
			const view = await this.options.displayFile(uri);
			if (!view?.state?.doc) return;
			const languageId = this.#resolveLanguageIdForUri(uri);
			const file = this.#getOrCreateFile(uri, languageId, view);
			const fileView = file.getView();
			if (fileView) {
				fileView.dispatch(update);
			}
		} catch (error) {
			console.error(`[LSP:Workspace] Failed to apply update: ${uri}`, error);
		}
	}

	async displayFile(uri: string): Promise<EditorView | null> {
		if (typeof this.options.displayFile === "function") {
			try {
				return await this.options.displayFile(uri);
			} catch (error) {
				console.error("[LSP:Workspace] Failed to display file", error);
			}
		}
		return null;
	}

	// ========================================================================
	// Workspace Folders Support
	// ========================================================================

	#getFolderName(uri: string): string {
		const parts = uri.replace(/\/$/, "").split("/");
		return parts[parts.length - 1] || uri;
	}

	#sendNotification(method: string, params: unknown): void {
		// Access the client's transport to send raw JSON-RPC notification
		const client = this.client as unknown as {
			connected: boolean;
			transport?: { send: (message: string) => void };
		};

		if (!client.connected || !client.transport) {
			console.warn(`[LSP:Workspace] Cannot send notification: not connected`);
			return;
		}

		const message = JSON.stringify({
			jsonrpc: "2.0",
			method,
			params,
		});

		client.transport.send(message);
	}

	hasWorkspaceFolder(uri: string): boolean {
		return this.#workspaceFolders.has(uri);
	}

	getWorkspaceFolders(): string[] {
		return Array.from(this.#workspaceFolders);
	}

	addWorkspaceFolder(uri: string): boolean {
		if (this.#workspaceFolders.has(uri)) {
			return false;
		}

		this.#workspaceFolders.add(uri);
		this.#sendNotification("workspace/didChangeWorkspaceFolders", {
			event: {
				added: [{ uri, name: this.#getFolderName(uri) }],
				removed: [],
			},
		});
		console.info(`[LSP:Workspace] Added workspace folder: ${uri}`);
		return true;
	}

	removeWorkspaceFolder(uri: string): boolean {
		if (!this.#workspaceFolders.has(uri)) {
			return false;
		}

		this.#workspaceFolders.delete(uri);
		this.#sendNotification("workspace/didChangeWorkspaceFolders", {
			event: {
				added: [],
				removed: [{ uri, name: this.#getFolderName(uri) }],
			},
		});
		console.info(`[LSP:Workspace] Removed workspace folder: ${uri}`);
		return true;
	}
}
