import lspApi from "cm/lsp/api";
import appSettings from "lib/settings";

function cloneLspSettings() {
	return JSON.parse(JSON.stringify(appSettings.value?.lsp || {}));
}

export function normalizeServerId(id) {
	return String(id || "")
		.trim()
		.toLowerCase();
}

export function normalizeLanguages(value) {
	if (Array.isArray(value)) {
		return value
			.map((lang) =>
				String(lang || "")
					.trim()
					.toLowerCase(),
			)
			.filter(Boolean);
	}

	return String(value || "")
		.split(",")
		.map((lang) => lang.trim().toLowerCase())
		.filter(Boolean);
}

export function getServerOverride(id) {
	return appSettings.value?.lsp?.servers?.[normalizeServerId(id)] || {};
}

export function isCustomServer(id) {
	return getServerOverride(id).custom === true;
}

export async function updateServerConfig(serverId, partial) {
	const key = normalizeServerId(serverId);
	if (!key) {
		throw new Error("Server id is required");
	}

	const current = cloneLspSettings();
	current.servers = current.servers || {};
	const nextServer = {
		...(current.servers[key] || {}),
	};

	Object.entries(partial || {}).forEach(([entryKey, value]) => {
		if (value === undefined) {
			delete nextServer[entryKey];
			return;
		}
		nextServer[entryKey] = value;
	});

	if (Object.keys(nextServer).length) {
		current.servers[key] = nextServer;
	} else {
		delete current.servers[key];
	}

	await appSettings.update({ lsp: current }, false);
}

export async function upsertCustomServer(serverId, config) {
	const key = normalizeServerId(serverId);
	if (!key) {
		throw new Error("Server id is required");
	}

	const existingServer = lspApi.servers.get(key);
	if (existingServer && getServerOverride(key).custom !== true) {
		throw new Error("A built-in server already uses this id");
	}

	const languages = normalizeLanguages(config.languages);
	if (!languages.length) {
		throw new Error("At least one language id is required");
	}

	const current = cloneLspSettings();
	current.servers = current.servers || {};
	const existing = current.servers[key] || {};
	const hasTransport = Object.prototype.hasOwnProperty.call(
		config,
		"transport",
	);
	const hasLauncher = Object.prototype.hasOwnProperty.call(config, "launcher");
	const nextConfig = {
		...existing,
		...config,
		custom: true,
		label: config.label || existing.label || key,
		languages,
		transport: hasTransport
			? config.transport
			: existing.transport || { kind: "websocket" },
		launcher: hasLauncher ? config.launcher : existing.launcher,
		enabled: config.enabled !== false,
	};

	const installKind = nextConfig.launcher?.install?.kind;
	if (installKind && installKind !== "shell") {
		const providedExecutable =
			nextConfig.launcher.install.binaryPath ||
			nextConfig.launcher.install.executable;
		if (!providedExecutable) {
			throw new Error(
				"Managed installers must declare the executable path or command they provide",
			);
		}
	}

	current.servers[key] = nextConfig;
	await appSettings.update({ lsp: current }, false);

	const definition = {
		id: key,
		label: nextConfig.label,
		languages,
		transport: nextConfig.transport,
		launcher: nextConfig.launcher,
		clientConfig: nextConfig.clientConfig,
		initializationOptions: nextConfig.initializationOptions,
		startupTimeout: nextConfig.startupTimeout,
		enabled: nextConfig.enabled !== false,
	};

	lspApi.upsert(definition);
	return key;
}

export async function removeCustomServer(serverId) {
	const key = normalizeServerId(serverId);
	const current = cloneLspSettings();
	current.servers = current.servers || {};
	delete current.servers[key];
	await appSettings.update({ lsp: current }, false);
	lspApi.servers.unregister(key);
}
