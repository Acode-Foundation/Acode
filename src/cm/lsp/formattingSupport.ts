import type { LspServerDefinition } from "./types";

export function supportsBuiltinFormatting(
	server: LspServerDefinition,
): boolean {
	return server.clientConfig?.builtinExtensions?.formatting !== false;
}
