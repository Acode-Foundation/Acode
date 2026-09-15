import type { Extension } from "@codemirror/state";
import type { LanguageExtensionProvider } from "./modelist";

type FileLanguage = {
	currentLanguageExtension?: LanguageExtensionProvider | null;
};
type PreparedLanguage = {
	provider: LanguageExtensionProvider;
	value: Extension | Promise<Extension>;
};
const prepared = new WeakMap<FileLanguage, PreparedLanguage>();

/** Start only the restored foreground tab's language, alongside file I/O. */
export function preloadFileLanguage(file: FileLanguage): Promise<void> {
	const provider = file.currentLanguageExtension;
	if (typeof provider !== "function") return Promise.resolve();
	let entry = prepared.get(file);
	if (!entry || entry.provider !== provider) {
		try {
			entry = { provider, value: provider() };
			prepared.set(file, entry);
		} catch (error) {
			return Promise.reject(error);
		}
	}
	const current = entry;
	return Promise.resolve(current.value).then(
		(value) => {
			current.value = value;
		},
		(error) => {
			if (prepared.get(file) === current) prepared.delete(file);
			throw error;
		},
	);
}

/** Briefly await highlighting, then let text open with language loading in the background. */
export async function waitForFileLanguage(file: FileLanguage): Promise<void> {
	const entry = prepared.get(file);
	if (entry && entry.provider === file.currentLanguageExtension) {
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				entry.value,
				new Promise<void>((resolve) => {
					timer = setTimeout(resolve, 250);
				}),
			]);
		} catch {
			/* A failed language must not prevent opening the file. */
		} finally {
			clearTimeout(timer);
		}
	}
}

/** Consume a startup preparation once; later settings changes use the provider again. */
export function getFileLanguageExtension(
	file: FileLanguage,
): Extension | Promise<Extension> {
	const entry = prepared.get(file);
	if (entry && entry.provider === file.currentLanguageExtension) {
		prepared.delete(file);
		return entry.value;
	}
	return file.currentLanguageExtension?.() || [];
}
