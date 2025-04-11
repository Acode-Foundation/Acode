const fs = require("node:fs");
const path = require("node:path");

const sourceDir = "./ace-builds/src-min";
const destDir = "./www/js/ace";

function updateAce() {
	try {
		// Remove existing destination directory if it exists
		if (fs.existsSync(destDir)) {
			fs.rmSync(destDir, { recursive: true });
			console.log("Removed existing destination directory");
		}

		// Create destination directory
		fs.mkdirSync(destDir, { recursive: true });
		console.log("Created new destination directory");

		// Read all files from source directory
		const files = fs.readdirSync(sourceDir);

		files.forEach((file) => {
			const sourcePath = path.join(sourceDir, file);
			const destPath = path.join(destDir, file);

			// Skip snippets directory and worker files
			if (file === "snippets" || file.startsWith("worker-")) {
				console.log(`Skipping: ${file}`);
				return;
			}

			// Copy if it's a file
			if (fs.statSync(sourcePath).isFile()) {
				fs.copyFileSync(sourcePath, destPath);
				console.log(`Copied: ${file}`);
			}
		});

		console.log("Ace editor files updated successfully!");
	} catch (error) {
		console.error("Error updating Ace editor files:", error);
	}
}

updateAce();
