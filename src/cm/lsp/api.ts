import { defineBundle, defineServer, installers } from "./providerUtils";
import {
	getServerBundle,
	listServerBundles,
	registerServerBundle,
	unregisterServerBundle,
} from "./serverCatalog";
import {
	getServer,
	getServersForLanguage,
	listServers,
	onRegistryChange,
	type RegisterServerOptions,
	registerServer,
	type ServerUpdater,
	unregisterServer,
	updateServer,
} from "./serverRegistry";
import type {
	LspServerBundle,
	LspServerDefinition,
	LspServerManifest,
} from "./types";

export { defineBundle, defineServer, installers };

export type LspRegistrationEntry = LspServerManifest | LspServerBundle;

function isBundleEntry(entry: LspRegistrationEntry): entry is LspServerBundle {
	return typeof (entry as LspServerBundle)?.getServers === "function";
}

export function register(
	entry: LspRegistrationEntry,
	options?: RegisterServerOptions & { replace?: boolean },
): LspServerDefinition | LspServerBundle {
	if (isBundleEntry(entry)) {
		return registerServerBundle(entry, options);
	}

	return registerServer(entry, options);
}

export function upsert(
	entry: LspRegistrationEntry,
): LspServerDefinition | LspServerBundle {
	return register(entry, { replace: true });
}

export const servers = {
	get(id: string): LspServerDefinition | null {
		return getServer(id);
	},
	list(): LspServerDefinition[] {
		return listServers();
	},
	listForLanguage(
		languageId: string,
		options?: { includeDisabled?: boolean },
	): LspServerDefinition[] {
		return getServersForLanguage(languageId, options);
	},
	update(id: string, updater: ServerUpdater): LspServerDefinition | null {
		return updateServer(id, updater);
	},
	unregister(id: string): boolean {
		return unregisterServer(id);
	},
	onChange(listener: Parameters<typeof onRegistryChange>[0]): () => void {
		return onRegistryChange(listener);
	},
};

export const bundles = {
	list(): LspServerBundle[] {
		return listServerBundles();
	},
	getForServer(id: string): LspServerBundle | null {
		return getServerBundle(id);
	},
	unregister(id: string): boolean {
		return unregisterServerBundle(id);
	},
};

const lspApi = {
	defineServer,
	defineBundle,
	register,
	upsert,
	installers,
	servers,
	bundles,
};

export default lspApi;
