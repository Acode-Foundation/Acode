import toast from "components/toast";
import { createTransport } from "../transport";
import {
	checkServerInstallation,
	ensureServerRunning,
	getInstallCommand as getAlpineInstallCommand,
	getUninstallCommand as getAlpineUninstallCommand,
	installServer,
	uninstallServer,
} from "../serverLauncher";
import { isBuiltinAlpineAccessible } from "../runtimeProviders";
import type {
	LspRuntimeContext,
	LspRuntimeProvider,
	LspServerDefinition,
} from "../types";

export const BUILTIN_ALPINE_RUNTIME_ID = "builtin-alpine";

export const builtinAlpineRuntimeProvider: LspRuntimeProvider = {
	id: BUILTIN_ALPINE_RUNTIME_ID,
	label: "Built-in Alpine",
	priority: -100,

	canHandle(
		server: LspServerDefinition,
		context: LspRuntimeContext,
	): boolean {
		return (
			!!server.launcher &&
			(context.allowNonTerminalWorkspace === true ||
				isBuiltinAlpineAccessible(context))
		);
	},

	checkInstallation(server, context) {
		return checkServerInstallation(server);
	},

	async install(server, context, mode, options) {
		const terminal = (
			globalThis as unknown as {
				Terminal?: { isInstalled?: () => Promise<boolean> | boolean };
			}
		).Terminal;
		let isTerminalInstalled = false;
		try {
			isTerminalInstalled = Boolean(await terminal?.isInstalled?.());
		} catch {}
		if (!isTerminalInstalled) {
			const message =
				strings?.terminal_required_message_for_lsp ??
				"Terminal not installed. Please install Terminal first to use builtin LSP servers.";
			toast(message);
			return false;
		}

		return installServer(server, mode, options);
	},

	uninstall(server, context, options) {
		return uninstallServer(server, options);
	},

	getInstallCommand(server, context, mode) {
		return getAlpineInstallCommand(server, mode);
	},

	getUninstallCommand(server) {
		return getAlpineUninstallCommand(server);
	},

	async start(server, context) {
		const session = context.serverId || server.id;
		const result = await ensureServerRunning(server, session);
		const transport = createTransport(server, {
			...context,
			dynamicPort: result.discoveredPort,
		});
		return {
			kind: "transport",
			providerId: BUILTIN_ALPINE_RUNTIME_ID,
			transport,
		};
	},
};

export default builtinAlpineRuntimeProvider;
