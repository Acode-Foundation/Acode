import type {
	InstallCheckResult,
	LspRuntimeProvider,
	LspServerDefinition,
	TransportContext,
	TransportHandle,
} from "../types";
import { createWorkerTransport } from "../workerTransport";

export const WEB_WORKER_RUNTIME_ID = "web-worker";

const SUPPORTED_SERVERS = new Set(["html", "css", "json", "typescript"]);
const WORKER_URLS: Record<string, string> = {
	html: "build/htmlLspWorker.js",
	css: "build/cssLspWorker.js",
	json: "build/jsonLspWorker.js",
	typescript: "build/typescriptLspWorker.js",
};
const STARTUP_TIMEOUT = 10000;

const bundledStatus: InstallCheckResult = {
	status: "present",
	version: "bundled",
	canInstall: false,
	canUpdate: false,
	message: "Built into Acode and runs offline in a Web Worker.",
};

async function readFileFromHost(uri: string): Promise<string> {
	const { default: fsOperation } = await import("fileSystem");
	const fs = fsOperation(uri);
	if (!fs) throw new Error(`No filesystem provider can handle ${uri}`);
	return (await fs.readFile("utf-8")) as string;
}

function createBuiltinWorkerTransport(
	server: LspServerDefinition,
	context: TransportContext,
): TransportHandle {
	const workerUrl = WORKER_URLS[server.id];
	if (!workerUrl) {
		throw new Error(`No built-in worker is available for ${server.id}`);
	}

	return createWorkerTransport({
		url: workerUrl,
		name: `acode-${server.id}-lsp`,
		serverId: server.id,
		startupTimeout: server.startupTimeout ?? STARTUP_TIMEOUT,
		configure: {
			kind: "configure",
			serverId: server.id,
			initializationOptions: server.initializationOptions,
			rootUri: context.originalRootUri ?? context.rootUri,
		},
		hostHandlers: {
			readFile: async (params) => {
				const uri = String(params.uri ?? "");
				if (!uri) throw new Error("A filesystem URI is required");
				return readFileFromHost(uri);
			},
		},
	});
}

export const webWorkerRuntimeProvider: LspRuntimeProvider = {
	id: WEB_WORKER_RUNTIME_ID,
	label: "Built-in Web Worker",
	priority: 100,

	canHandle(server) {
		return SUPPORTED_SERVERS.has(server.id) && typeof Worker !== "undefined";
	},

	resolveUris(_server, context) {
		return {
			documentUri: context.originalDocumentUri,
			rootUri: context.originalRootUri,
			scope: "workspace",
		};
	},

	async checkInstallation() {
		return bundledStatus;
	},

	getInstallCommand() {
		return null;
	},

	getUninstallCommand() {
		return null;
	},

	async start(server, context) {
		return {
			kind: "transport",
			providerId: WEB_WORKER_RUNTIME_ID,
			transport: createBuiltinWorkerTransport(server, context),
		};
	},
};

export default webWorkerRuntimeProvider;
