import { builtinServerBundles } from "./servers";
import type { LspServerBundle, LspServerManifest } from "./types";

function toKey(id: string | undefined | null): string {
	return String(id ?? "")
		.trim()
		.toLowerCase();
}

interface RegistryAdapter {
	registerServer: (
		definition: LspServerManifest,
		options?: { replace?: boolean },
	) => unknown;
	unregisterServer: (id: string) => boolean;
}

const bundles = new Map<string, LspServerBundle>();
const bundleServers = new Map<string, Set<string>>();
const serverOwners = new Map<string, string>();

let registryAdapter: RegistryAdapter | null = null;
let builtinsRegistered = false;

export function bindServerRegistry(adapter: RegistryAdapter): void {
	registryAdapter = adapter;
}

function requireRegistry(): RegistryAdapter {
	if (!registryAdapter) {
		throw new Error("LSP server catalog is not bound to the registry");
	}
	return registryAdapter;
}

function resolveBundleServers(bundle: LspServerBundle): LspServerManifest[] {
	const servers = bundle.getServers();
	return Array.isArray(servers) ? servers : [];
}

export function registerServerBundle(
	bundle: LspServerBundle,
	options: { replace?: boolean } = {},
): LspServerBundle {
	const { replace = false } = options;
	const key = toKey(bundle.id);
	if (!key) {
		throw new Error("LSP server bundle requires a non-empty id");
	}

	if (bundles.has(key) && !replace) {
		const existing = bundles.get(key);
		if (existing) return existing;
	}

	const registry = requireRegistry();
	const definitions = resolveBundleServers(bundle);
	const previousIds = bundleServers.get(key) || new Set<string>();
	const nextIds = new Set<string>();

	for (const definition of definitions) {
		const serverId = toKey(definition.id);
		if (!serverId) {
			throw new Error(`LSP server bundle ${key} returned a server without id`);
		}

		const owner = serverOwners.get(serverId);
		if (owner && owner !== key && !replace) {
			throw new Error(
				`LSP server ${serverId} is already provided by ${owner}; ${key} must replace explicitly`,
			);
		}

		registry.registerServer(definition, { replace: true });
		serverOwners.set(serverId, key);
		nextIds.add(serverId);
	}

	for (const previousId of previousIds) {
		if (!nextIds.has(previousId) && serverOwners.get(previousId) === key) {
			registry.unregisterServer(previousId);
			serverOwners.delete(previousId);
		}
	}

	const normalizedBundle = {
		...bundle,
		id: key,
	};
	bundles.set(key, normalizedBundle);
	bundleServers.set(key, nextIds);
	return normalizedBundle;
}

export function unregisterServerBundle(id: string): boolean {
	const key = toKey(id);
	if (!key || !bundles.has(key)) return false;

	const registry = requireRegistry();
	for (const serverId of bundleServers.get(key) || []) {
		if (serverOwners.get(serverId) === key) {
			registry.unregisterServer(serverId);
			serverOwners.delete(serverId);
		}
	}

	bundleServers.delete(key);
	return bundles.delete(key);
}

export function listServerBundles(): LspServerBundle[] {
	return Array.from(bundles.values());
}

export function getServerBundle(id: string): LspServerBundle | null {
	const owner = serverOwners.get(toKey(id));
	if (!owner) return null;
	return bundles.get(owner) || null;
}

export function ensureBuiltinBundlesRegistered(): void {
	if (builtinsRegistered) return;
	builtinServerBundles.forEach((bundle) => {
		registerServerBundle(bundle, { replace: false });
	});
	builtinsRegistered = true;
}
