import {
	findRemoteStorageRoot,
	getStorageDisplayName,
} from "utils/storageRoot";
import { describe, expect, it } from "vitest";

const server = {
	name: "My server",
	url: "sftp://profile-123/",
	type: "sftp",
	storageType: "sftp",
	home: "/home/tony",
};

const storageList = [
	{ name: "Internal storage", url: "file:///storage/emulated/0/", type: "dir" },
	server,
];

describe("getStorageDisplayName", () => {
	it("uses the chosen alias for the storage root", () => {
		expect(getStorageDisplayName(storageList, "sftp://profile-123/")).toBe(
			"My server",
		);
	});

	it("uses the alias for the home directory the storage opens at", () => {
		// This is the reported bug: the folder showed "tony" because that is the
		// basename of /home/tony, dropping the alias chosen when adding it.
		expect(
			getStorageDisplayName(storageList, "sftp://profile-123/home/tony"),
		).toBe("My server");
		expect(
			getStorageDisplayName(storageList, "sftp://profile-123/home/tony/"),
		).toBe("My server");
	});

	it("describes a folder below the home directory relative to the alias", () => {
		expect(
			getStorageDisplayName(storageList, "sftp://profile-123/home/tony/myapp"),
		).toBe("My server / myapp");
	});

	it("describes a folder outside the home directory relative to the alias", () => {
		expect(
			getStorageDisplayName(storageList, "sftp://profile-123/var/www"),
		).toBe("My server / var/www");
	});

	it("falls back for local folders so their own name is kept", () => {
		expect(
			getStorageDisplayName(
				storageList,
				"file:///storage/emulated/0/Projects",
				"Projects",
			),
		).toBe("Projects");
	});

	it("does not treat a sibling path as being inside the storage", () => {
		expect(
			getStorageDisplayName(
				storageList,
				"sftp://profile-999/home/tony",
				"Other",
			),
		).toBe("Other");
	});

	it("copes with a missing home and unknown urls", () => {
		const list = [{ name: "Box", url: "sftp://profile-9/" }];
		expect(getStorageDisplayName(list, "sftp://profile-9/srv/app")).toBe(
			"Box / srv/app",
		);
		expect(getStorageDisplayName(list, "", "Fallback")).toBe("Fallback");
		expect(getStorageDisplayName(null, "sftp://profile-9/", "Fallback")).toBe(
			"Fallback",
		);
	});
});

describe("findRemoteStorageRoot", () => {
	it("returns the owning storage", () => {
		expect(
			findRemoteStorageRoot(storageList, "sftp://profile-123/home/tony"),
		).toBe(server);
	});

	it("ignores local storages", () => {
		expect(
			findRemoteStorageRoot(storageList, "file:///storage/emulated/0/Projects"),
		).toBeNull();
	});

	it("prefers the deepest matching storage", () => {
		const nested = {
			name: "Nested",
			url: "sftp://profile-123/home/tony/myapp",
			storageType: "sftp",
		};
		expect(
			findRemoteStorageRoot(
				[...storageList, nested],
				"sftp://profile-123/home/tony/myapp/src",
			),
		).toBe(nested);
	});
});
