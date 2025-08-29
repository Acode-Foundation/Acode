import { createDir } from "./createDir";
import { editFile } from "./editFile";
import { fetchTool } from "./fetch";
import { listDirectory } from "./listDirectory";
import { readFile } from "./readFile";

// Export all tools as a single object
export const allTools = {
	readFile,
	fetchTool,
	listDirectory,
	editFile,
	createDir,
};
