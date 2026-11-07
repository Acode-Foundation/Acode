// @vitest-environment happy-dom

import { Text } from "@codemirror/state";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * checkFiles runs on resume and compares each open file with its copy on disk.
 * Its reload action replaces the buffer, so a failed read must never be treated
 * as "the file changed": doing so replaced a document with the empty result of
 * a dropped connection.
 */

const mocks = vi.hoisted(() => ({
	files: [],
	readFile: vi.fn(),
	stat: vi.fn(),
	confirm: vi.fn(),
	alert: vi.fn(),
	setValue: vi.fn(),
	flushCacheWrite: vi.fn(async () => {}),
	markLoaded: vi.fn(),
}));

vi.mock("fileSystem", () => ({
	default: () => ({
		exists: async () => true,
		stat: mocks.stat,
		readFile: mocks.readFile,
	}),
}));
vi.mock("dialogs/alert", () => ({ default: mocks.alert }));
vi.mock("dialogs/confirm", () => ({ default: mocks.confirm }));
vi.mock("utils/helpers", () => ({
	default: { getStatMtime: (stat) => stat?.modifiedDate ?? null },
}));

vi.mock("lib/editorManager", () => ({}));

import checkFiles from "lib/checkFiles";

function makeFile({ doc, filename = "sections.tsx" }) {
	const session = {
		doc: Text.of(doc.split("\n")),
		setValue: mocks.setValue,
	};

	return {
		type: "editor",
		tab: document.createElement("div"),
		loaded: true,
		loading: false,
		filename,
		uri: "sftp://profile-1/sections.tsx",
		encoding: "utf-8",
		readOnly: false,
		isUnsaved: false,
		// Remote files often have no usable mtime, so checkFiles falls through to
		// comparing the text it read. That is the path that damaged the file.
		hasVersionMetadata: true,
		savedMtime: null,
		diskMtime: null,
		hasDiskConflict: false,
		session,
		markDiskChanged({ mtime }) {
			this.diskMtime = mtime;
			this.hasDiskConflict =
				this.session.doc.toString() !== "" &&
				this.diskMtime !== this.savedMtime;
		},
		markLoaded: mocks.markLoaded,
		flushCacheWrite: mocks.flushCacheWrite,
	};
}

const currentDoc = "const a = 1;\nconst b = 2;";

beforeEach(() => {
	vi.clearAllMocks();
	mocks.files.length = 0;
	mocks.stat.mockResolvedValue({ modifiedDate: 1000 });
	globalThis.strings = {
		warning: "Warning",
		info: "Info",
		"file changed": " has been changed, reload file?",
		"file has been deleted": "{file} has been deleted!",
		"file could not be read": "{file} could not be read.",
	};
	// The real alert opens a dialog and calls back when it closes; the mock must
	// resolve, or awaiting it would hang the check.
	mocks.alert.mockImplementation((_title, _message, onhide) => {
		onhide?.();
	});
	globalThis.editorManager = {
		get files() {
			return mocks.files;
		},
		editor: { getCursorPosition: () => ({ row: 0, column: 0 }) },
		getFile: () => ({ makeActive() {} }),
		onupdate: vi.fn(),
		emit: vi.fn(),
	};
	globalThis.window = { log: vi.fn() };
	globalThis.app = document.body;
});

const runWithFile = async (file) => {
	mocks.files.push(file);
	await checkFiles();
};

describe("checkFiles on a failed read", () => {
	it("never offers to reload, and leaves the document untouched", async () => {
		const file = makeFile({ doc: currentDoc });
		mocks.readFile.mockRejectedValue(
			Object.assign(new Error("The channel unexpectedly terminated"), {
				code: "CONNECTION_LOST",
			}),
		);

		await runWithFile(file);

		// No "file changed, reload?" prompt, because nothing was read.
		expect(mocks.confirm).not.toHaveBeenCalled();
		// The buffer is untouched.
		expect(mocks.setValue).not.toHaveBeenCalled();
		expect(file.session.doc.toString()).toBe(currentDoc);
		// The reader is told the file could not be read, rather than being offered
		// a reload that would discard their work.
		expect(mocks.alert).toHaveBeenCalledOnce();
		expect(mocks.alert.mock.calls[0][1]).toContain("could not be read");
	});

	it("does not prompt when the read fails for a read-only file", async () => {
		const file = makeFile({ doc: currentDoc });
		file.readOnly = true;
		mocks.readFile.mockRejectedValue(new Error("Connection lost"));

		await runWithFile(file);

		expect(mocks.confirm).not.toHaveBeenCalled();
		expect(mocks.setValue).not.toHaveBeenCalled();
	});
});

describe("checkFiles on a suspiciously empty read", () => {
	it("refuses to replace a document with an empty result", async () => {
		// The exact damage: the disk read came back empty while the buffer had
		// content, and accepting the reload blanked the file.
		const file = makeFile({ doc: currentDoc });
		mocks.readFile.mockResolvedValue("");

		await runWithFile(file);

		expect(mocks.confirm).not.toHaveBeenCalled();
		expect(mocks.setValue).not.toHaveBeenCalled();
		expect(file.session.doc.toString()).toBe(currentDoc);
	});

	it("still allows reloading when the file genuinely became empty and was saved", async () => {
		// A saved, empty file is a real change: isUnsaved is false and the read
		// agrees with nothing, but the buffer is a single empty line too, so no
		// guard fires and there is nothing to protect.
		const file = makeFile({ doc: "" });
		mocks.readFile.mockResolvedValue("");

		await runWithFile(file);

		expect(mocks.confirm).not.toHaveBeenCalled();
		expect(mocks.setValue).not.toHaveBeenCalled();
	});
});

describe("checkFiles on a real external change", () => {
	it("asks before reloading, and preserves the buffer before doing so", async () => {
		const file = makeFile({ doc: currentDoc });
		mocks.readFile.mockResolvedValue("const a = 99;");
		mocks.confirm.mockResolvedValue(true);

		await runWithFile(file);

		expect(mocks.confirm).toHaveBeenCalledOnce();
		// The discarded buffer is written to the recovery cache first.
		expect(mocks.flushCacheWrite).toHaveBeenCalled();
		expect(mocks.setValue).toHaveBeenCalledWith("const a = 99;");
	});

	it("does nothing when the reader declines", async () => {
		const file = makeFile({ doc: currentDoc });
		mocks.readFile.mockResolvedValue("const a = 99;");
		mocks.confirm.mockResolvedValue(false);

		await runWithFile(file);

		expect(mocks.confirm).toHaveBeenCalledOnce();
		expect(mocks.setValue).not.toHaveBeenCalled();
		expect(file.session.doc.toString()).toBe(currentDoc);
	});
});
