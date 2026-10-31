import { expect, it } from "vitest";
import setupSaveFile from "./helpers/saveFileHarness";

it("passes Create document options from Save File into the browser", async () => {
	const { saveFile, file, deviceFile, externalFs, recents, fileBrowser, uri } =
		setupSaveFile();

	await expect(saveFile(file)).resolves.toBe(true);

	expect(fileBrowser).toHaveBeenCalledWith("folder", "Save file", true, {
		chooseFolderOnDevice: true,
		createDocument: {
			filename: "Untitled.ts",
			mimeType: "text/typescript",
		},
	});
	expect(externalFs.createDocument).toHaveBeenCalledWith(
		"text/typescript",
		"Untitled.ts",
	);
	expect(deviceFile.writeFile).toHaveBeenCalledWith(
		"new file contents",
		"utf-8",
	);
	expect(file.uri).toBe(uri);
	expect(file.filename).toBe("New.ts");
	expect(file.SAFMode).toBe("single");
	expect(file.persistInSession).toBe(true);
	expect(recents.addFile).toHaveBeenCalledWith(uri);
});
