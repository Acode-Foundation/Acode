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
import {
	getRuntimeProvider,
	listRuntimeProviders,
	registerRuntimeProvider,
	selectRuntimeProvider,
	unregisterRuntimeProvider,
} from "./runtimeProviders";
import "./runtimes/registerBuiltins";
import type {
	LspRuntimeContext,
	LspRuntimeProvider,
	LspServerBundle,
	LspServerDefinition,
	LspServerManifest,
} from "./types";
import {
	createWorkerTransport,
	type LspWorkerTransportOptions,
} from "./workerTransport";

export { defineBundle, defineServer, installers };
export type { LspWorkerHostHandler, LspWorkerTransportOptions } from "./workerTransport";

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

export const runtimes = {
	register(provider: LspRuntimeProvider): LspRuntimeProvider {
		return registerRuntimeProvider(provider);
	},
	unregister(id: string): boolean {
		return unregisterRuntimeProvider(id);
	},
	get(id: string): LspRuntimeProvider | null {
		return getRuntimeProvider(id);
	},
	list(): LspRuntimeProvider[] {
		return listRuntimeProviders();
	},
	select(
		server: LspServerDefinition,
		context?: LspRuntimeContext,
	): Promise<LspRuntimeProvider | null> {
		return selectRuntimeProvider(server, context);
	},
};

export const registerRuntime = runtimes.register;
export const unregisterRuntime = runtimes.unregister;

export const workers = {
	createTransport(options: LspWorkerTransportOptions) {
		return createWorkerTransport(options);
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
	runtimes,
	workers,
	registerRuntimeProvider: registerRuntime,
	unregisterRuntimeProvider: unregisterRuntime,
};

export default lspApi;
