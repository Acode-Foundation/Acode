import toast from "components/toast";
import confirm from "dialogs/confirm";
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
	LspRuntimeUriResolutionContext,
} from "../types";

export const BUILTIN_ALPINE_RUNTIME_ID = "builtin-alpine";

function isUntitled(context: LspRuntimeContext): boolean {
	return /^untitled:/i.test(
		String(context.originalDocumentUri || context.uri || ""),
	);
}

function cacheDocumentUri(context: LspRuntimeContext): string | null {
	const cacheFile = context.file?.cacheFile;
	if (!cacheFile || typeof cacheFile !== "string") return null;
	if (/^file:\/\//i.test(cacheFile)) return cacheFile;
	const path = cacheFile.startsWith("/") ? cacheFile : `/${cacheFile}`;
	return `file://${encodeURI(path).replace(/#/g, "%23")}`;
}

function canUseRealPath(context: LspRuntimeContext): boolean {
	return isBuiltinAlpineAccessible({
		...context,
		rootUri: context.originalRootUri || context.rootUri,
		uri: context.originalDocumentUri || context.uri,
	});
}

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
			(canUseRealPath(context) ||
				(isUntitled(context) && !!cacheDocumentUri(context)) ||
				(context.allowNonTerminalWorkspace === true &&
					!!cacheDocumentUri(context)))
		);
	},

	resolveUris(
		server: LspServerDefinition,
		context: LspRuntimeUriResolutionContext,
	) {
		if (canUseRealPath(context) && !isUntitled(context)) return null;

		const documentUri = cacheDocumentUri(context);
		return {
			documentUri,
			rootUri: null,
			scope: "document",
		};
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
				"Terminal not installed. Please install Terminal first to use LSP servers.";

			if (!localStorage.getItem("dontAskTerminalRequiredForLsp")) {
				const response = await confirm(strings?.error, message, false, {
					checkboxText: strings["don't ask again"],
					returnState: true,
				});
				if (
					typeof response === "object" &&
					response.confirmed &&
					response.checked
				) {
					localStorage.setItem("dontAskTerminalRequiredForLsp", "true");
				}
			} else {
				toast(message);
			}
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
