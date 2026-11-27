/**
 * Loads the mime-types package on demand. Its MIME database is large and is
 * never needed during startup.
 * @returns {Promise<typeof import("mime-types")>}
 */
export default async function loadMimeTypes() {
	const { default: mimeTypes } = await import(
		/* webpackChunkName: "mimeTypes" */ "mime-types"
	);
	return mimeTypes;
}
