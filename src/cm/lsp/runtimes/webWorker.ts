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

interface ListedEntry {
	name: string;
	url: string;
	isDirectory?: boolean;
	isFile?: boolean;
	isLink?: boolean;
}

const bundledStatus: InstallCheckResult = {
	status: "present",
	version: "bundled",
	canInstall: false,
	canUpdate: false,
	message: "Built into Acode and runs offline in a Web Worker.",
};

async function fileSystemFor(uri: string) {
	const { default: fsOperation } = await import("fileSystem");
	const fs = fsOperation(uri);
	if (!fs) throw new Error(`No filesystem provider can handle ${uri}`);
	return fs;
}

async function readFileFromHost(
	uri: string,
	maxBytes?: number,
): Promise<string> {
	const fs = await fileSystemFor(uri);
	if (maxBytes && typeof fs.stat === "function") {
		const { size } = await fs.stat();
		if (size > maxBytes) throw new Error(`${uri} exceeds ${maxBytes} bytes`);
	}
	return (await fs.readFile("utf-8")) as string;
}

async function readDirectoryFromHost(uri: string) {
	const fs = await fileSystemFor(uri);
	const entries: ListedEntry[] = await fs.lsDir();
	return entries.map((entry) => ({
		name: entry.name,
		url: entry.url,
		// Symlinked folders (e.g. pnpm's node_modules) are listed as links.
		isDirectory: !!entry.isDirectory || (!!entry.isLink && !entry.isFile),
	}));
}

function requireUri(params: Record<string, unknown>): string {
	const uri = String(params.uri ?? "");
	if (!uri) throw new Error("A filesystem URI is required");
	return uri;
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
			readFile: (params) =>
				readFileFromHost(
					requireUri(params),
					Number(params.maxBytes) || undefined,
				),
			readDirectory: (params) => readDirectoryFromHost(requireUri(params)),
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
