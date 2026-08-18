import type {
	InstallCheckResult,
	LspRuntimeProvider,
} from "../types";
import { EXTERNAL_WEBSOCKET_RUNTIME_ID } from "../runtimeProviders";

const externallyManagedStatus: InstallCheckResult = {
	status: "unknown",
	version: null,
	canInstall: false,
	canUpdate: false,
	message: "This server is managed externally over WebSocket.",
};

export const externalWebSocketRuntimeProvider: LspRuntimeProvider = {
	id: EXTERNAL_WEBSOCKET_RUNTIME_ID,
	label: "External WebSocket",
	priority: -50,

	canHandle(server, context) {
		if (context.runtimeAction && server.launcher) {
			return false;
		}
		return server.transport?.kind === "websocket" && !!server.transport.url;
	},

	async checkInstallation() {
		return externallyManagedStatus;
	},

	getInstallCommand() {
		return null;
	},

	getUninstallCommand() {
		return null;
	},

	async start(server) {
		const url = server.transport?.url;
		if (!url) {
			throw new Error(`WebSocket server ${server.id} has no URL`);
		}
		return {
			kind: "websocket",
			providerId: EXTERNAL_WEBSOCKET_RUNTIME_ID,
			url,
			protocols: server.transport.protocols,
		};
	},
};

export default externalWebSocketRuntimeProvider;
