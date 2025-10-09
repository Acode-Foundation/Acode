import fsOperation from "fileSystem";
import { StructuredTool } from "@langchain/core/tools";
import { addedFolder } from "lib/openFolder";
import { z } from "zod";

/**
 * Tool for listing files and directories in a given path
 */
class ListDirectoryTool extends StructuredTool {
	name = "listDirectory";
	description = "Lists files and directories in a given path";
	schema = z.object({
		path: z
			.string()
			.describe(
				"The relative path of the directory to list. This path must never be absolute. The first component of the path should always be the name of a root directory in the project (as shown in the sidebar). For example, if the root directories are 'directory1' and 'directory2', you can list the contents of 'directory1' by using the path 'directory1'. If the root directories are 'foo' and 'bar', and you want to list the contents of the directory 'foo/baz', you should use the path 'foo/baz'.",
			),
	});

	async _call({ path }) {
		try {
			// Handle special cases: ".", "", "./", "*"
			if (path === "." || path === "" || path === "./" || path === "*") {
				// List all root directories (project roots)
				const rootDirs = addedFolder
					.filter((folder) => folder && folder.title)
					.map((folder) => folder.title)
					.join("\n");
				return rootDirs;
			}

			// Split the path to get project name and subpath
			const pathParts = path.split("/");
			const projectName = pathParts[0];
			const subPath = pathParts.slice(1).join("/");

			// Find the project in addedFolder array
			const project = addedFolder.find(
				(folder) => folder.title === projectName,
			);
			if (!project) {
				return `Error: Path '${path}' not found in opened projects`;
			}

			// Construct the full URL
			const dirUrl = subPath ? project.url + "/" + subPath : project.url;

			// List directory entries
			const entries = await fsOperation(dirUrl).lsDir();
			if (!Array.isArray(entries)) {
				return `Error: Path not found: ${path}`;
			}

			// Separate folders and files
			const folders = [];
			const files = [];
			for (const entry of entries) {
				// Skip "." and ".."
				if (entry.name === "." || entry.name === "..") continue;
				const entryRelPath = subPath ? subPath + "/" + entry.name : entry.name;
				if (entry.isDirectory) {
					folders.push(`${projectName}/${entryRelPath}`);
				} else if (entry.isFile) {
					files.push(`${projectName}/${entryRelPath}`);
				}
			}

			let output = "";
			if (folders.length > 0) {
				output += `# Folders:\n${folders.join("\n")}\n`;
			}
			if (files.length > 0) {
				output += `\n# Files:\n${files.join("\n")}\n`;
			}
			if (output.trim() === "") {
				output = `${path} is empty.`;
			}
			return output.trim();
		} catch (error) {
			return `Error reading directory: ${error.message}`;
		}
	}
}

export const listDirectory = new ListDirectoryTool();
