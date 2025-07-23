import { fetchTool } from "./fetch";
import { listDirectory } from "./listDirectory";
import { readFile } from "./readFile";

// Export all tools as a single object
export const allTools = {
	readFile,
	fetchTool,
	listDirectory,
};
