/**
 * Read the best available local preview for a remote editor file.
 * Editor recovery data takes precedence because it can contain unsaved changes.
 * The transport cache is optional and must never block the remote load.
 *
 * @param {Object} options
 * @param {import("fileSystem").FileSystem} options.editorCache
 * @param {import("fileSystem").FileSystem | null} options.transportCache
 * @param {string} [options.encoding]
 * @returns {Promise<{editorCacheExists: boolean, text: string | null}>}
 */
export async function readRemoteFilePreview({
	editorCache,
	transportCache,
	encoding,
}) {
	const editorCacheExists = await editorCache.exists();

	if (editorCacheExists) {
		return {
			editorCacheExists,
			text: await editorCache.readFile(encoding),
		};
	}

	try {
		if (transportCache && (await transportCache.exists())) {
			return {
				editorCacheExists,
				text: await transportCache.readFile(encoding),
			};
		}
	} catch (_error) {
		// The transport cache is only a preview; continue with the remote load.
	}

	return { editorCacheExists, text: null };
}
