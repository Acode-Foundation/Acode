import fsOperation from "fileSystem";
import { StructuredTool } from "@langchain/core/tools";
import { addedFolder } from "lib/openFolder";
import { z } from "zod";

/**
 * Tool for reading file contents in Acode
 */
class ReadFileTool extends StructuredTool {
	name = "readFile";
	description = "Reads the content of the given file in the project.";
	schema = z.object({
		path: z
			.string()
			.describe(
				"The relative path of the file to read. This path should never be absolute, and the first component of the path should always be a root directory in a project (opened in sidebar). For example, if root directories are 'directory1' and 'directory2', to access 'file.txt' in 'directory1', use 'directory1/file.txt'. To access 'file.txt' in 'directory2', use 'directory2/file.txt'.",
			),
		startLine: z
			.number()
			.min(1)
			.optional()
			.describe("line number to start reading on (1-based index)"),
		endLine: z
			.number()
			.min(1)
			.optional()
			.describe("line number to end reading on (1-based index, inclusive)"),
	});

	/**
	 * Check if a URI is a SAF URI
	 */
	isSafUri(uri) {
		return uri.startsWith("content://") && uri.includes("/tree/");
	}

	/**
	 * Check if SAF URI already has the :: separator (complete format)
	 */
	isCompleteSafUri(uri) {
		return this.isSafUri(uri) && uri.includes("::");
	}

	/**
	 * Construct SAF URI for file access
	 */
	constructSafFileUri(baseUri, filePath) {
		// For incomplete SAF URIs (without ::), construct the full format
		// baseUri::primary:fullFilePath
		return `${baseUri}::primary:${filePath}`;
	}

	async _call({ path, startLine, endLine }) {
		try {
			// Split the path to get project name and file path
			const pathParts = path.split("/");
			const projectName = pathParts[0];
			const filePath = pathParts.slice(1).join("/");

			// Find the project in addedFolder array
			const project = addedFolder.find(
				(folder) => folder.title === projectName,
			);
			if (!project) {
				return `Error: Project '${projectName}' not found in opened projects`;
			}

			let fileUrl;

			// Check if this is a SAF URI
			if (this.isSafUri(project.url)) {
				if (this.isCompleteSafUri(project.url)) {
					// SAF URI already has :: separator, just append the file path normally
					// Handle both cases: with trailing slash or without
					const baseUrl = project.url.endsWith("/")
						? project.url
						: project.url + "/";
					fileUrl = baseUrl + filePath;
				} else {
					// SAF URI without :: separator, use the special format
					fileUrl = this.constructSafFileUri(project.url, path);
				}
			} else {
				// For regular file URIs, use the normal path concatenation
				fileUrl = project.url + "/" + filePath;
			}

			// Read the file content
			const content = await fsOperation(fileUrl).readFile("utf8");

			// If startLine or endLine are specified, filter the content
			if (startLine !== undefined || endLine !== undefined) {
				const lines = content.split("\n");
				const start = startLine ? startLine - 1 : 0;
				const end = endLine ? endLine : lines.length;
				return lines.slice(start, end).join("\n");
			}

			return content;
		} catch (error) {
			return `Error reading file: ${error.message}`;
		}
	}
}

export const readFile = new ReadFileTool();
