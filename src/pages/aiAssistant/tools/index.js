import { createDir } from "./createDir";
import { editFile } from "./editFile";
import { fetchTool } from "./fetch";
import { listDirectory } from "./listDirectory";
import { openUrl } from "./openUrl";
import { readFile } from "./readFile";
import { searchCode } from "./searchCode";
import { interactiveTerminal, terminal } from "./terminal";

// Export all tools as a single object
export const allTools = {
	readFile,
	fetchTool,
	listDirectory,
	editFile,
	createDir,
	terminal,
	interactiveTerminal,
	searchCode,
	openUrl,
};
