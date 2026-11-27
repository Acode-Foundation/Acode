/**
 * Validates and normalizes `system.launchAppWithFile` options into the
 * argument the native `launch-app-with-file` action expects.
 * @returns The native argument, or an error message.
 */
export default function launchAppWithFileArgs(
	options: LaunchAppWithFileOptions,
): Record<string, unknown> | string {
	if (!options || typeof options !== "object") {
		return "an options object is required.";
	}

	const app = trimmed(options.app);
	const className = trimmed(options.className);
	const fileUri = trimmed(options.fileUri);
	const fileUris = uniqueNames(options.fileUris);

	if (className && !app) {
		return '"className" requires "app" (the package name).';
	}
	if (!app && !fileUri && !fileUris.length) {
		return 'nothing to launch, provide "app" and/or a file.';
	}

	return {
		app,
		className,
		fileUri,
		fileUris,
		filename: trimmed(options.filename),
		clipLabel: trimmed(options.clipLabel),
		mimeType: trimmed(options.mimeType),
		action: trimmed(options.action),
		categories: names(options.categories),
		flags: Array.isArray(options.flags) ? options.flags : [],
		extras:
			options.extras && typeof options.extras === "object"
				? options.extras
				: null,
		writeAccess: !!options.writeAccess,
		attachAsStream: !!options.attachAsStream,
		newTask: options.newTask === undefined ? true : !!options.newTask,
	};
}

function trimmed(value: unknown): string {
	if (value === undefined || value === null) return "";
	return String(value).trim();
}

function names(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.map(trimmed).filter(Boolean);
}

function uniqueNames(value: unknown): string[] {
	return [...new Set(names(value))];
}
