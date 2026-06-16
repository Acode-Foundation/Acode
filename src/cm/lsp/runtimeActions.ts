import { selectRuntimeProvider } from "./runtimeProviders";
import type {
	InstallCheckResult,
	LspRuntimeContext,
	LspRuntimeProvider,
	LspServerDefinition,
} from "./types";

function getSettingsContext(
	server: LspServerDefinition,
	context: LspRuntimeContext = {},
): LspRuntimeContext {
	return {
		...context,
		serverId: context.serverId || server.id,
		allowNonTerminalWorkspace: true,
	};
}

async function getProvider(
	server: LspServerDefinition,
	context: LspRuntimeContext = {},
): Promise<LspRuntimeProvider | null> {
	return selectRuntimeProvider(server, getSettingsContext(server, context));
}

export async function checkRuntimeServerInstallation(
	server: LspServerDefinition,
	context?: LspRuntimeContext,
): Promise<InstallCheckResult> {
	const provider = await getProvider(server, context);
	if (!provider?.checkInstallation) {
		return {
			status: "unknown",
			version: null,
			canInstall: false,
			canUpdate: false,
			message: "The selected runtime does not provide installation checks.",
		};
	}
	return provider.checkInstallation(server, getSettingsContext(server, context));
}

export async function installRuntimeServer(
	server: LspServerDefinition,
	mode: "install" | "update" | "reinstall" = "install",
	options: { promptConfirm?: boolean } = {},
	context?: LspRuntimeContext,
): Promise<boolean> {
	const provider = await getProvider(server, context);
	if (!provider?.install) {
		throw new Error("The selected runtime does not support installation.");
	}
	return provider.install(server, getSettingsContext(server, context), mode, options);
}

export async function uninstallRuntimeServer(
	server: LspServerDefinition,
	options: { promptConfirm?: boolean } = {},
	context?: LspRuntimeContext,
): Promise<boolean> {
	const provider = await getProvider(server, context);
	if (!provider?.uninstall) {
		throw new Error("The selected runtime does not support uninstall.");
	}
	return provider.uninstall(server, getSettingsContext(server, context), options);
}

export async function getRuntimeInstallCommand(
	server: LspServerDefinition,
	mode: "install" | "update" = "install",
	context?: LspRuntimeContext,
): Promise<string | null> {
	const provider = await getProvider(server, context);
	return (
		provider?.getInstallCommand?.(
			server,
			getSettingsContext(server, context),
			mode,
		) ?? null
	);
}

export async function getRuntimeUninstallCommand(
	server: LspServerDefinition,
	context?: LspRuntimeContext,
): Promise<string | null> {
	const provider = await getProvider(server, context);
	return (
		provider?.getUninstallCommand?.(
			server,
			getSettingsContext(server, context),
		) ?? null
	);
}

export async function getRuntimeLabelForServer(
	server: LspServerDefinition,
	context?: LspRuntimeContext,
): Promise<string> {
	const provider = await getProvider(server, context);
	return provider?.label || "Unavailable";
}
