import type { EditorView } from "@codemirror/view";
import whenAppVisible from "utils/whenAppVisible";
import type * as LspClient from "./client";
import type { ClientManagerOptions } from "./types";

type LspClientModule = typeof LspClient;
type LspPluginInstance = ReturnType<LspClientModule["LSPPlugin"]["get"]>;

let client: LspClientModule | null = null;
let loading: Promise<LspClientModule> | null = null;
let pendingOptions: Partial<ClientManagerOptions> = {};

/**
 * The client module once loaded, otherwise null. While it is null no editor
 * can have a language server attached.
 */
export function getLoadedLspClient(): LspClientModule | null {
	return client;
}

/** Loads the client once the editor is visible; calls share one load. */
export function loadLspClient(): Promise<LspClientModule> {
	loading ??= whenAppVisible()
		.then(() => import(/* webpackChunkName: "lspClient" */ "./client"))
		.then(
			(module) => {
				module.clientManager.setOptions(pendingOptions);
				pendingOptions = {};
				client = module;
				return module;
			},
			(error) => {
				loading = null;
				throw error;
			},
		);
	return loading;
}

/** Client options, kept until the client loads. */
export function setLspOptions(options: Partial<ClientManagerOptions>): void {
	if (client) client.clientManager.setOptions(options);
	else pendingOptions = { ...pendingOptions, ...options };
}

export function getLspPlugin(
	view: EditorView,
	lspClient?: Parameters<LspClientModule["LSPPlugin"]["get"]>[1],
): LspPluginInstance | null {
	return client?.LSPPlugin.get(view, lspClient) ?? null;
}

export function getAllLspPlugins(
	view: EditorView,
	feature?: Parameters<LspClientModule["LSPPlugin"]["getAll"]>[1],
): ReturnType<LspClientModule["LSPPlugin"]["getAll"]> {
	return client?.LSPPlugin.getAll(view, feature) ?? [];
}

export function getLspPluginForFeature(
	view: EditorView,
	feature: Parameters<LspClientModule["LSPPlugin"]["getForFeature"]>[1],
): ReturnType<LspClientModule["LSPPlugin"]["getForFeature"]> | null {
	return client?.LSPPlugin.getForFeature(view, feature) ?? null;
}
