import serverRegistry from "./serverRegistry";

function getCurrentFileLanguage() {
	try {
		const file = window.editorManager?.activeFile;
		if (!file || file.type !== "editor") return null;
		return file.currentMode?.toLowerCase() || null;
	} catch {
		return null;
	}
}

function getServersForCurrentFile() {
	const language = getCurrentFileLanguage();
	if (!language) return [];

	try {
		return serverRegistry.getServersForLanguage(language);
	} catch {
		return [];
	}
}

function hasConnectedServers() {
	return getServersForCurrentFile().length > 0;
}

export {
	getCurrentFileLanguage,
	getServersForCurrentFile,
	hasConnectedServers,
};
