import {
	isBuiltinAlpineAccessible,
	registerRuntimeProvider,
	selectRuntimeProvider,
	unregisterRuntimeProvider,
} from "../cm/lsp/runtimeProviders";
import { builtinAlpineRuntimeProvider } from "../cm/lsp/runtimes/builtinAlpine";
import { TestRunner } from "./tester";

const SERVER = {
	id: "test-lsp",
	launcher: {},
};

function resolutionContext(uri, cacheFile, overrides = {}) {
	return {
		uri,
		originalDocumentUri: uri,
		documentUri: null,
		originalRootUri: uri,
		rootUri: uri,
		normalizedDocumentUri: null,
		normalizedRootUri: null,
		file: { cacheFile, uri },
		...overrides,
	};
}

export async function runLspRuntimeTests(writeOutput) {
	const runner = new TestRunner("LSP runtime URI handling");

	runner.test(
		"untitled files use a document-scoped cache URI",
		async (test) => {
			const context = resolutionContext(
				"untitled://acode/42",
				"/data/user/0/com.foxdebug.acode/cache/42",
			);
			test.assert(
				!isBuiltinAlpineAccessible(context),
				"untitled URI must not be considered directly accessible",
			);
			test.assert(
				await builtinAlpineRuntimeProvider.canHandle(SERVER, context),
				"Alpine should handle an untitled file through its cache",
			);
			const resolved = await builtinAlpineRuntimeProvider.resolveUris(
				SERVER,
				context,
			);
			test.assertEqual(resolved.scope, "document");
			test.assertEqual(resolved.rootUri, null);
			test.assertEqual(
				resolved.documentUri,
				"file:///data/user/0/com.foxdebug.acode/cache/42",
			);
		},
	);

	runner.test(
		"inaccessible SAF requires the external-folder setting",
		async (test) => {
			const context = resolutionContext(
				"content://com.termux.documents/document/home%3Aproject%2Fmain.js",
				"/data/user/0/com.foxdebug.acode/cache/43",
			);
			test.assert(
				!(await builtinAlpineRuntimeProvider.canHandle(SERVER, context)),
				"Alpine must not claim inaccessible SAF by default",
			);
			test.assert(
				await builtinAlpineRuntimeProvider.canHandle(SERVER, {
					...context,
					allowNonTerminalWorkspace: true,
				}),
				"Alpine may claim it when cache fallback is enabled",
			);
		},
	);

	runner.test(
		"Alpine-accessible paths keep workspace mapping",
		async (test) => {
			const uri =
				"content://com.foxdebug.acode.documents/tree/%2Fdata%2Fuser%2F0%2Fcom.foxdebug.acode%2Ffiles%2Fpublic";
			const context = resolutionContext(uri, "/unused", {
				normalizedDocumentUri:
					"file:///data/user/0/com.foxdebug.acode/files/public/main.js",
				normalizedRootUri:
					"file:///data/user/0/com.foxdebug.acode/files/public",
			});
			test.assert(isBuiltinAlpineAccessible(context));
			test.assertEqual(
				await builtinAlpineRuntimeProvider.resolveUris(SERVER, context),
				null,
				"Accessible paths should retain normal workspace resolution",
			);
		},
	);

	runner.test(
		"custom runtime can claim and map original content URI",
		async (test) => {
			const providerId = "test-termux-content-runtime";
			const provider = registerRuntimeProvider({
				id: providerId,
				label: "Test Termux Runtime",
				priority: 1000,
				canHandle(server, context) {
					return context.uri.startsWith("content://com.termux.documents/");
				},
				resolveUris(server, context) {
					test.assert(
						context.originalDocumentUri.startsWith(
							"content://com.termux.documents/",
						),
						"provider must receive the untouched content URI",
					);
					return {
						documentUri: "file:///data/data/com.termux/files/home/main.js",
						rootUri: "file:///data/data/com.termux/files/home",
						scope: "workspace",
					};
				},
				async start() {
					throw new Error("not used by URI selection test");
				},
			});

			try {
				const context = resolutionContext(
					"content://com.termux.documents/document/%2Fdata%2Fdata%2Fcom.termux%2Ffiles%2Fhome%2Fmain.js",
					"/data/user/0/com.foxdebug.acode/cache/44",
					{ allowNonTerminalWorkspace: true },
				);
				const selected = await selectRuntimeProvider(SERVER, context);
				test.assertEqual(selected.id, providerId);
				const mapped = await provider.resolveUris(SERVER, context);
				test.assertEqual(
					mapped.documentUri,
					"file:///data/data/com.termux/files/home/main.js",
				);
				test.assertEqual(mapped.scope, "workspace");
			} finally {
				unregisterRuntimeProvider(providerId);
			}
		},
	);

	return runner.run(writeOutput);
}
