import fsOperation from "fileSystem";
import { StructuredTool } from "@langchain/core/tools";
import { addedFolder } from "lib/openFolder";
import { z } from "zod";

/**
 * Tool for creating a new file or editing an existing file in Acode
 */
class EditFileTool extends StructuredTool {
	name = "editFile";
	description =
		"This is a tool for creating a new file or editing an existing file. For moving or renaming files, you should generally use the `terminal` tool with the 'mv' command instead.";
	schema = z.object({
		path: z
			.string()
			.describe(
				"The relative path of the file to edit or create. This path should never be absolute, and the first component of the path should always be a root directory in a project (opened in sidebar). For example, if root directories are 'directory1' and 'directory2', to edit 'file.txt' in 'directory1', use 'directory1/file.txt'. To edit 'file.txt' in 'directory2', use 'directory2/file.txt'.",
			),
		mode: z
			.enum(["edit", "create", "overwrite"])
			.describe(
				"The mode of operation on the file. Possible values: 'edit' - Make granular edits to an existing file (requires oldString and newString), 'create' - Create a new file if it doesn't exist, 'overwrite' - Replace the entire contents of an existing file. When a file already exists, prefer editing it as opposed to recreating it from scratch.",
			),
		content: z
			.string()
			.optional()
			.describe(
				"The content to write to the file. Required for 'create' and 'overwrite' modes.",
			),
		oldString: z
			.string()
			.optional()
			.describe(
				"The text to replace (required for 'edit' mode). Must match exactly including whitespace. Can be empty string to insert text at the beginning of newString location.",
			),
		newString: z
			.string()
			.optional()
			.describe(
				"The replacement text (required for 'edit' mode). Can be empty string to delete the oldString.",
			),
		replaceAll: z
			.boolean()
			.optional()
			.describe(
				"If true, replace all occurrences of oldString. If false (default), replace only the first occurrence.",
			),
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

	/**
	 * Check if file exists
	 */
	async fileExists(fileUrl) {
		try {
			const stat = await fsOperation(fileUrl).stat();
			return stat.isFile;
		} catch (error) {
			return false;
		}
	}

	async _call({
		path,
		mode,
		content,
		oldString,
		newString,
		replaceAll = false,
	}) {
		try {
			// Validate inputs based on mode
			if (mode === "edit") {
				if (oldString === undefined || newString === undefined) {
					return `Error: 'edit' mode requires both 'oldString' and 'newString' parameters.`;
				}
			} else if (mode === "create" || mode === "overwrite") {
				if (content === undefined) {
					return `Error: '${mode}' mode requires 'content' parameter.`;
				}
			}

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

			// Check if file exists
			const exists = await this.fileExists(fileUrl);

			// Handle different modes
			switch (mode) {
				case "create":
					if (exists) {
						return `Error: File '${path}' already exists. Use 'edit' or 'overwrite' mode instead.`;
					}
					// For creating files, we need to use createFile method
					// Extract directory URL and filename
					const fileName = filePath.split("/").pop();
					const dirPath = pathParts.slice(1, -1).join("/");

					let dirUrl;
					if (this.isSafUri(project.url)) {
						if (this.isCompleteSafUri(project.url)) {
							const baseUrl = project.url.endsWith("/")
								? project.url
								: project.url + "/";
							dirUrl = dirPath ? baseUrl + dirPath : project.url;
						} else {
							dirUrl = dirPath
								? this.constructSafFileUri(
										project.url,
										projectName + "/" + dirPath,
									)
								: project.url;
						}
					} else {
						dirUrl = dirPath ? project.url + "/" + dirPath : project.url;
					}

					await fsOperation(dirUrl).createFile(fileName, content);
					return `File '${path}' has been successfully created.`;

				case "overwrite":
					if (!exists) {
						return `Error: File '${path}' does not exist. Use 'create' mode instead.`;
					}
					await fsOperation(fileUrl).writeFile(content);
					return `File '${path}' has been successfully overwritten.`;

				case "edit":
					if (!exists) {
						return `Error: File '${path}' does not exist. Use 'create' mode instead.`;
					}

					// Read current content
					const currentContent = await fsOperation(fileUrl).readFile("utf8");

					// Handle empty oldString (insertion at beginning of file)
					if (oldString === "") {
						const updatedContent = newString + currentContent;
						await fsOperation(fileUrl).writeFile(updatedContent);
						return `File '${path}' has been successfully edited. Inserted text at beginning of file.`;
					}

					// Check if oldString exists in the file
					if (!currentContent.includes(oldString)) {
						// Provide more helpful error message
						const lines = currentContent.split("\n");
						const preview =
							lines.length > 5
								? `First 5 lines:\n${lines
										.slice(0, 5)
										.map((line, i) => `${i + 1}: ${line}`)
										.join("\n")}`
								: `File content:\n${lines.map((line, i) => `${i + 1}: ${line}`).join("\n")}`;
						return `Error: The text to replace was not found in '${path}'.\n\nSearching for:\n${JSON.stringify(oldString)}\n\n${preview}`;
					}

					// Count occurrences for reporting
					const occurrenceCount = (
						currentContent.match(
							new RegExp(oldString.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
						) || []
					).length;

					// Perform the replacement
					let updatedContent;
					if (replaceAll) {
						// Replace all occurrences using replaceAll method
						updatedContent = currentContent.replaceAll(oldString, newString);
					} else {
						// Replace only first occurrence
						updatedContent = currentContent.replace(oldString, newString);
					}

					// Check if replacement actually changed the content
					if (updatedContent === currentContent) {
						return `Warning: No changes were made to '${path}'. The 'oldString' and 'newString' are identical.`;
					}

					// Write the updated content
					await fsOperation(fileUrl).writeFile(updatedContent);

					const replacedCount = replaceAll ? occurrenceCount : 1;
					const message = replaceAll
						? `File '${path}' has been successfully edited. Replaced ${replacedCount} occurrence(s) of the text.`
						: `File '${path}' has been successfully edited. Replaced first occurrence of the text (${occurrenceCount} total found).`;

					return message;

				default:
					return `Error: Invalid mode '${mode}'. Use 'create', 'edit', or 'overwrite'.`;
			}
		} catch (error) {
			return `Error processing file: ${error.message}`;
		}
	}
}

export const editFile = new EditFileTool();
