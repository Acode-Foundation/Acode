// @vitest-environment happy-dom

import { expect, it } from "vitest";
import setupEditorFile from "./helpers/editorFileHarness";
import setupSaveFile from "./helpers/saveFileHarness";

it("keeps Create document available in the Save destination window", async () => {
	const { saveFile, file, deviceFile, externalFs, recents, fileBrowser, uri } =
		setupSaveFile("select-android-document");

	await expect(saveFile(file)).resolves.toBe(true);

	expect(recents.select).toHaveBeenCalledWith(
		[
			["select-folder", "Select folder", "folder"],
			["select-android-document", "Create document on device", "save"],
		],
		"dir",
		"Select folder",
	);
	expect(fileBrowser).not.toHaveBeenCalled();
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

it("keeps the existing recovery identity when Create Document Save As fails", async () => {
	const { saveFile, file, deviceFile, externalFs, recents } = setupSaveFile(
		"select-android-document",
	);
	const originalUri = "content://provider/original-document";
	file.uri = originalUri;
	file.filename = "Original.ts";
	file.SAFMode = "tree";
	file.persistInSession = true;
	externalFs.createDocument.mockResolvedValue({
		uri: "content://provider/new-document",
		filename: "New.ts",
		persistedUriPermission: false,
	});
	deviceFile.writeFile.mockRejectedValueOnce(new Error("Write failed"));

	await expect(saveFile(file, true)).resolves.toBe(false);

	expect(file.uri).toBe(originalUri);
	expect(file.filename).toBe("Original.ts");
	expect(file.SAFMode).toBe("tree");
	expect(file.persistInSession).toBe(true);
	expect(file.markSaved).not.toHaveBeenCalled();
	expect(recents.addFile).not.toHaveBeenCalled();
});

it("renames a real EditorFile before locking it to a single SAF document", async () => {
	const saveHarness = setupSaveFile("select-android-document");
	const { file } = setupEditorFile();
	const createdUri = "content://provider/created-document/New.js";
	saveHarness.externalFs.createDocument.mockResolvedValue({
		uri: createdUri,
		filename: "New.js",
		persistedUriPermission: true,
	});
	file.setMode.mockClear();

	await expect(saveHarness.saveFile(file, true)).resolves.toBe(true);

	expect(file.filename).toBe("New.js");
	expect(file.SAFMode).toBe("single");
	expect(file.uri).toBe(createdUri);
	expect(file.setMode).toHaveBeenCalledOnce();
});
