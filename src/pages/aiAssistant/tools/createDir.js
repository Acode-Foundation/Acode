import fsOperation from "fileSystem";
import { StructuredTool } from "@langchain/core/tools";
import { addedFolder } from "lib/openFolder";
import { z } from "zod";

/**
 * Tool for creating directories in Acode
 */
class CreateDirTool extends StructuredTool {
	name = "createDir";
	description =
		"Creates a new directory at the specified path within the project. Returns confirmation that the directory was created. This tool creates a directory and all necessary parent directories (similar to `mkdir -p`). It should be used whenever you need to create new directories within the project.";
	schema = z.object({
		path: z
			.string()
			.describe(
				"The relative path of the directory to create. This path should never be absolute, and the first component of the path should always be a root directory in a project (opened in sidebar). For example, if root directories are 'directory1' and 'directory2', to create 'newdir' in 'directory1', use 'directory1/newdir'. To create nested directories like 'directory1/foo/bar', use 'directory1/foo/bar'.",
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
	 * Construct SAF URI for directory access
	 */
	constructSafDirUri(baseUri, dirPath) {
		// For incomplete SAF URIs (without ::), construct the full format
		// baseUri::primary:fullDirPath
		return `${baseUri}::primary:${dirPath}`;
	}

	/**
	 * Check if directory exists
	 */
	async directoryExists(dirUrl) {
		try {
			const stat = await fsOperation(dirUrl).stat();
			return stat.isDirectory;
		} catch (error) {
			return false;
		}
	}

	async _call({ path }) {
		try {
			// Split the path to get project name and directory path
			const pathParts = path.split("/");
			const projectName = pathParts[0];
			const dirPath = pathParts.slice(1).join("/");

			// Find the project in addedFolder array
			const project = addedFolder.find(
				(folder) => folder.title === projectName,
			);
			if (!project) {
				return `Error: Project '${projectName}' not found in opened projects`;
			}

			let dirUrl;

			// Check if this is a SAF URI
			if (this.isSafUri(project.url)) {
				if (this.isCompleteSafUri(project.url)) {
					// SAF URI already has :: separator, just append the directory path normally
					// Handle both cases: with trailing slash or without
					const baseUrl = project.url.endsWith("/")
						? project.url
						: project.url + "/";
					dirUrl = baseUrl + dirPath;
				} else {
					// SAF URI without :: separator, use the special format
					dirUrl = this.constructSafDirUri(project.url, path);
				}
			} else {
				// For regular file URIs, use the normal path concatenation
				dirUrl = project.url + "/" + dirPath;
			}

			// Check if directory already exists
			const exists = await this.directoryExists(dirUrl);
			if (exists) {
				return `Directory '${path}' already exists.`;
			}

			// Create the directory using createDirectory method
			// Extract parent directory URL and directory name
			const dirName = dirPath.split("/").pop();
			const parentPath = pathParts.slice(1, -1).join("/");

			let parentUrl;
			if (this.isSafUri(project.url)) {
				if (this.isCompleteSafUri(project.url)) {
					const baseUrl = project.url.endsWith("/")
						? project.url
						: project.url + "/";
					parentUrl = parentPath ? baseUrl + parentPath : project.url;
				} else {
					parentUrl = parentPath
						? this.constructSafDirUri(
								project.url,
								projectName + "/" + parentPath,
							)
						: project.url;
				}
			} else {
				parentUrl = parentPath ? project.url + "/" + parentPath : project.url;
			}

			await fsOperation(parentUrl).createDirectory(dirName);

			return `Directory '${path}' has been successfully created.`;
		} catch (error) {
			return `Error creating directory: ${error.message}`;
		}
	}
}

export const createDir = new CreateDirTool();
