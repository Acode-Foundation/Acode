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
	runtimeAction: LspRuntimeContext["runtimeAction"] = "command",
): LspRuntimeContext {
	return {
		...context,
		serverId: context.serverId || server.id,
		allowNonTerminalWorkspace: true,
		runtimeAction,
	};
}

async function getProvider(
	server: LspServerDefinition,
	context: LspRuntimeContext = {},
	runtimeAction?: LspRuntimeContext["runtimeAction"],
): Promise<LspRuntimeProvider | null> {
	return selectRuntimeProvider(
		server,
		getSettingsContext(server, context, runtimeAction),
	);
}

export async function checkRuntimeServerInstallation(
	server: LspServerDefinition,
	context?: LspRuntimeContext,
): Promise<InstallCheckResult> {
	const settingsContext = getSettingsContext(server, context, "checkInstallation");
	const provider = await getProvider(server, context, "checkInstallation");
	if (!provider?.checkInstallation) {
		return {
			status: "unknown",
			version: null,
			canInstall: false,
			canUpdate: false,
			message: "The selected runtime does not provide installation checks.",
		};
	}
	return provider.checkInstallation(server, settingsContext);
}

export async function installRuntimeServer(
	server: LspServerDefinition,
	mode: "install" | "update" | "reinstall" = "install",
	options: { promptConfirm?: boolean } = {},
	context?: LspRuntimeContext,
): Promise<boolean> {
	const settingsContext = getSettingsContext(server, context, "install");
	const provider = await getProvider(server, context, "install");
	if (!provider?.install) {
		throw new Error("The selected runtime does not support installation.");
	}
	return provider.install(server, settingsContext, mode, options);
}

export async function uninstallRuntimeServer(
	server: LspServerDefinition,
	options: { promptConfirm?: boolean } = {},
	context?: LspRuntimeContext,
): Promise<boolean> {
	const settingsContext = getSettingsContext(server, context, "uninstall");
	const provider = await getProvider(server, context, "uninstall");
	if (!provider?.uninstall) {
		throw new Error("The selected runtime does not support uninstall.");
	}
	return provider.uninstall(server, settingsContext, options);
}

export async function getRuntimeInstallCommand(
	server: LspServerDefinition,
	mode: "install" | "update" = "install",
	context?: LspRuntimeContext,
): Promise<string | null> {
	const settingsContext = getSettingsContext(server, context, "command");
	const provider = await getProvider(server, context, "command");
	return (
		provider?.getInstallCommand?.(
			server,
			settingsContext,
			mode,
		) ?? null
	);
}

export async function getRuntimeUninstallCommand(
	server: LspServerDefinition,
	context?: LspRuntimeContext,
): Promise<string | null> {
	const settingsContext = getSettingsContext(server, context, "command");
	const provider = await getProvider(server, context, "command");
	return (
		provider?.getUninstallCommand?.(
			server,
			settingsContext,
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
