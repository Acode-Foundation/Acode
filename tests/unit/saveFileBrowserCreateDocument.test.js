// @vitest-environment happy-dom

import { afterEach, expect, it, vi } from "vitest";
import setupFileBrowser from "./helpers/fileBrowserHarness";

afterEach(() => {
	document.body.replaceChildren();
	localStorage.clear();
});

function click(row) {
	row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

it("renders and handles Create document in the real Save File browser", async () => {
	const browser = setupFileBrowser();
	const result = browser.FileBrowser("folder", "Save file", true, {
		chooseFolderOnDevice: true,
		createDocument: { filename: "New.ts", mimeType: "text/typescript" },
	});

	await vi.waitFor(() => {
		expect(browser.app.querySelector("#list")).not.toBeNull();
	});
	const rows = browser.app.querySelector("#list");
	const createDocumentRow = rows.querySelector("[data-open-create-document]");
	expect(createDocumentRow).not.toBeNull();
	expect(rows.querySelector("[data-open-native-folder]")).not.toBeNull();
	expect(rows.querySelector("[data-open-doc]")).toBeNull();

	click(createDocumentRow);

	await expect(result).resolves.toMatchObject({
		type: "file",
		url: browser.createdUri,
		name: "New.ts",
		mode: "single",
	});
	expect(browser.externalFs.createDocument).toHaveBeenCalledWith(
		"text/typescript",
		"New.ts",
	);
});

it.each([
	[
		"Save File",
		"Save file",
		{
			chooseFolderOnDevice: true,
			createDocument: {
				filename: "New.ts",
				mimeType: "text/typescript",
			},
		},
		true,
	],
	["Open Folder", undefined, { chooseFolderOnDevice: true }, false],
])("offers and handles Choose folder on device in the %s browser only", async (_context, info, options, hasCreateDocument) => {
	const browser = setupFileBrowser();
	const result = browser.FileBrowser("folder", info, true, options);

	await vi.waitFor(() => {
		expect(browser.app.querySelector("#list")).not.toBeNull();
	});
	const rows = browser.app.querySelector("#list");
	const folderRow = rows.querySelector("[data-open-native-folder]");
	expect(folderRow).not.toBeNull();
	expect(Boolean(rows.querySelector("[data-open-create-document]"))).toBe(
		hasCreateDocument,
	);
	expect(rows.querySelector("[data-open-doc]")).toBeNull();

	click(folderRow);

	await expect(result).resolves.toMatchObject({
		type: "folder",
		url: browser.folderUri,
		name: "Projects",
	});
	expect(browser.externalFs.getStorageAccessPermission).toHaveBeenCalledWith(
		"",
	);
});

it("keeps Create document and Choose folder out of the Open File browser", async () => {
	const browser = setupFileBrowser();
	const result = browser.FileBrowser("file");

	await vi.waitFor(() => {
		expect(browser.app.querySelector("#list")).not.toBeNull();
	});
	const rows = browser.app.querySelector("#list");
	const selectDocumentRow = rows.querySelector("[data-open-doc]");
	expect(selectDocumentRow).not.toBeNull();
	expect(rows.querySelector("[data-open-create-document]")).toBeNull();
	expect(rows.querySelector("[data-open-native-folder]")).toBeNull();

	click(selectDocumentRow);

	await expect(result).resolves.toMatchObject({
		type: "file",
		url: browser.selectedUri,
		name: "Picked.ts",
		mode: "single",
	});
	expect(browser.sdcard.openDocumentFile).toHaveBeenCalledOnce();
});
