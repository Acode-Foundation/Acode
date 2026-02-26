import type { EditorView } from "@codemirror/view";
import { getModes } from "cm/modelist";
import toast from "components/toast";
import lspClientManager from "./clientManager";
import serverRegistry from "./serverRegistry";
import type { AcodeApi, FileMetadata } from "./types";

interface Mode {
	name?: string;
	extensions?: string;
}

interface EditorManagerWithLsp {
	editor?: EditorView;
	activeFile?: AcodeFile;
	getLspMetadata?: (file: AcodeFile) => FileMetadata | null;
}

function getActiveMetadata(
	manager: EditorManagerWithLsp | undefined,
	file: AcodeFile | undefined,
): (FileMetadata & { view?: EditorView }) | null {
	if (!manager?.getLspMetadata || !file) return null;
	const metadata = manager.getLspMetadata(file);
	if (!metadata) return null;
	return {
		...metadata,
		view: manager.editor,
	};
}

export function registerLspFormatter(acode: AcodeApi): void {
	const languages = new Set<string>();
	serverRegistry.listServers().forEach((server) => {
		(server.languages || []).forEach((lang) => {
			if (lang) languages.add(String(lang));
		});
	});
	const extensions = languages.size
		? collectFormatterExtensions(languages)
		: ["*"];

	acode.registerFormatter(
		"lsp",
		extensions,
		async () => {
			const manager = window.editorManager as EditorManagerWithLsp | undefined;
			const file = manager?.activeFile;
			const metadata = getActiveMetadata(manager, file);
			if (!metadata) {
				toast("LSP formatter unavailable");
				return false;
			}
			const languageId = metadata.languageId;
			if (!languageId) {
				toast("Unknown language for LSP formatting");
				return false;
			}
			const servers = serverRegistry.getServersForLanguage(languageId);
			if (!servers.length) {
				toast("No LSP formatter available");
				return false;
			}
			const fullMetadata = {
				...metadata,
				languageName: metadata.languageName || languageId,
			};
			const success = await lspClientManager.formatDocument(fullMetadata);
			if (!success) {
				toast("LSP formatter failed");
			}
			return success;
		},
		"Language Server",
	);
}

function collectFormatterExtensions(languages: Set<string>): string[] {
	const extensions = new Set<string>();
	const modeMap = new Map<string, Mode>();

	try {
		const modes = getModes() as Mode[];
		modes.forEach((mode) => {
			const key = String(mode?.name ?? "")
				.trim()
				.toLowerCase();
			if (key) modeMap.set(key, mode);
		});
	} catch (_) {
		// Ignore mode loading errors
	}

	languages.forEach((language) => {
		const key = String(language ?? "")
			.trim()
			.toLowerCase();
		if (!key) return;
		extensions.add(key);
		const mode = modeMap.get(key);
		if (!mode?.extensions) return;
		String(mode.extensions)
			.split("|")
			.forEach((part) => {
				const ext = part.trim();
				if (ext && !ext.startsWith("^")) {
					extensions.add(ext);
				}
			});
	});

	if (!extensions.size) {
		return ["*"];
	}

	return Array.from(extensions);
}
