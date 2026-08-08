import type {
    LspRuntimeProvider,
    LspRuntimeContext,
    LspRuntimeUriResolutionContext,
    LspRuntimeConnection,
} from "../types";
import { getRuntimeProvider } from "../runtimeProviders";

function sftpUriToFileUri(uri: string): string | null {
    const match = /^sftp:\/\/[^/]*(\/.*)$/.exec(uri);
    if (!match) return null;
    const path = match[1].split("?")[0];
    if (!path) return null;
    const encoded = encodeURI(path).replace(/#/g, "%23");
    return `file://${encoded}`;

}

export const sftpRemoteRuntimeProvider: LspRuntimeProvider = {
    id: "sftp-remote",
    label: "SFTP Remote",
    priority: -30,

    canHandle(server, context) {
        const uri = String(context.rootUri || context.uri || "");
        return /^sftp:/i.test(uri);
    },

    resolveUris(server, context: LspRuntimeUriResolutionContext) {
        const documentUri = sftpUriToFileUri(context.originalDocumentUri);
        const rootUri = context.originalRootUri
            ? sftpUriToFileUri(context.originalRootUri)
            : null;
        return { documentUri, rootUri, scope: "workspace" };
    },

    async start(server, context: LspRuntimeContext): Promise<LspRuntimeConnection> {
        // Delegate transport to external-websocket provider
        const external = getRuntimeProvider("external-websocket");
        if (!external || !external.start) {
            throw new Error("SFTP workspace requires external-websocket transport provider");
        }
        return external.start(server, context);
    },
};
