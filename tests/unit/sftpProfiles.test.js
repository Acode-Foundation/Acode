import { beforeEach, describe, expect, it, vi } from "vitest";

const { deleteMock } = vi.hoisted(() => ({ deleteMock: vi.fn() }));

vi.mock("fileSystem", () => ({
	default: () => ({ delete: deleteMock }),
}));

import {
	createSftpProfileUrl,
	editSftpProfile,
	getSftpProfileId,
	getSftpProfileInfo,
	migrateLegacySftpProfiles,
} from "lib/sftpProfiles";

describe("SFTP secure profiles", () => {
	beforeEach(() => {
		const values = new Map();
		globalThis.localStorage = {
			getItem: (key) => values.get(key) ?? null,
			setItem: (key, value) => values.set(key, String(value)),
			removeItem: (key) => values.delete(key),
		};
		globalThis.DATA_STORAGE = "file:///data/";
		deleteMock.mockReset();
	});

	it("creates and recognizes opaque profile URLs", () => {
		const url = createSftpProfileUrl("profile-123", "/project/file.js");
		expect(url).toBe("sftp://profile-123/project/file.js");
		expect(getSftpProfileId(url)).toBe("profile-123");
		expect(getSftpProfileId("sftp://user:secret@example.com/project")).toBeNull();
		expect(
			getSftpProfileId("sftp://user:secret@profile-server/project"),
		).toBeNull();
	});

	it("passes transient form credentials to the encrypted native profile store", async () => {
		const editProfile = vi.fn((...args) => {
			args.at(-2)({ profileId: "profile-native" });
		});
		globalThis.sftp = { editProfile };

		await editSftpProfile({
			hostname: "example.com",
			port: 2222,
			username: "user",
			authType: "key",
			keyFile: "content://private-key",
			passPhrase: "key secret",
		});

		expect(editProfile).toHaveBeenCalledWith(
			null,
			"example.com",
			2222,
			"user",
			"key",
			"",
			"content://private-key",
			"key secret",
			expect.any(Function),
			expect.any(Function),
		);
	});

	it("reads only non-secret profile metadata from native storage", async () => {
		const getProfileInfo = vi.fn((profileId, resolve) => {
			resolve({
				profileId,
				hostname: "example.com",
				port: 22,
				username: "user",
				authType: "password",
			});
		});
		globalThis.sftp = { getProfileInfo };

		const profile = await getSftpProfileInfo("profile-native");

		expect(profile).not.toHaveProperty("password");
		expect(profile).not.toHaveProperty("privateKey");
	});

	it("migrates repeated credential URLs once and removes credentials", async () => {
		const saveProfile = vi.fn((...args) => {
			const onSuccess = args.at(-2);
			onSuccess("profile-abcd");
		});
		globalThis.sftp = { saveProfile };
		const root = "sftp://user:p%40ss@example.com:2222/";
		const file = "sftp://user:p%40ss@example.com:2222/project/app.js";
		localStorage.setItem(
			"storageList",
			JSON.stringify([{ storageType: "sftp", url: root }]),
		);
		localStorage.setItem("recentFiles", JSON.stringify([file]));

		await migrateLegacySftpProfiles();

		expect(saveProfile).toHaveBeenCalledTimes(1);
		expect(JSON.parse(localStorage.getItem("storageList"))[0].url).toBe(
			"sftp://profile-abcd/",
		);
		expect(JSON.parse(localStorage.getItem("recentFiles"))[0]).toBe(
			"sftp://profile-abcd/project/app.js",
		);
		expect(localStorage.getItem("storageList")).not.toContain("p%40ss");
		expect(localStorage.getItem("sftpNativeProfileMigration")).toBe("2");

		const restoredLegacy = "sftp://other:secret@example.net/";
		localStorage.setItem("recentFolders", JSON.stringify([restoredLegacy]));
		await migrateLegacySftpProfiles();
		expect(saveProfile).toHaveBeenCalledTimes(1);
		expect(JSON.parse(localStorage.getItem("recentFolders"))[0]).toBe(
			restoredLegacy,
		);
	});

	it("removes failed connections and recovers unsaved remote files", async () => {
		globalThis.sftp = {
			saveProfile: (...args) =>
				args.at(-1)(new Error("Keystore unavailable for secret")),
		};
		const legacy = "sftp://user:secret@example.com/";
		localStorage.setItem(
			"storageList",
			JSON.stringify([{ storageType: "sftp", url: legacy }]),
		);
		localStorage.setItem("recentFiles", JSON.stringify([`${legacy}app.js`]));
		localStorage.setItem(
			"files",
			JSON.stringify([
				{
					id: "cached-unsaved-file",
					uri: `${legacy}draft.js`,
					filename: "draft.js",
					isUnsaved: true,
				},
				{
					id: "clean-remote-file",
					uri: `${legacy}saved.js`,
					filename: "saved.js",
					isUnsaved: false,
				},
			]),
		);

		const result = await migrateLegacySftpProfiles();
		const files = JSON.parse(localStorage.getItem("files"));

		expect(JSON.parse(localStorage.getItem("storageList"))).toEqual([]);
		expect(JSON.parse(localStorage.getItem("recentFiles"))).toEqual([]);
		expect(files).toHaveLength(1);
		expect(files[0]).toMatchObject({
			id: "cached-unsaved-file",
			uri: null,
			filename: "Recovered draft.js",
			isUnsaved: true,
			deletedFile: true,
		});
		expect(JSON.stringify(files)).not.toContain("secret");
		expect(result).toMatchObject({
			removedReferences: 4,
			recoveredFiles: 1,
		});
		expect(result.failures).toEqual([
			{
				hostname: "example.com",
				username: "user",
				message: "Keystore unavailable for [redacted]",
			},
		]);
		expect(localStorage.getItem("sftpNativeProfileMigration")).toBe("2");
	});

	it("scrubs malformed legacy SFTP values instead of marking them migrated", async () => {
		globalThis.sftp = { saveProfile: vi.fn() };
		localStorage.setItem(
			"recentFiles",
			JSON.stringify([
				"sftp:///missing-host",
				"sftp://user:%E0%A4%A@example.com/bad-encoding",
			]),
		);

		const result = await migrateLegacySftpProfiles();

		expect(JSON.parse(localStorage.getItem("recentFiles"))).toEqual([]);
		expect(result.failures[0].message).toBe(
			"The saved SFTP address is incomplete",
		);
		expect(result.failures[1].message).toBe("URI malformed");
		expect(localStorage.getItem("sftpNativeProfileMigration")).toBe("2");
	});

	it("deletes an app-owned legacy key copy when its profile cannot migrate", async () => {
		globalThis.sftp = {
			saveProfile: (...args) => args.at(-1)("Private key is unreadable"),
		};
		const legacy =
			"sftp://user@example.com/?keyFile=file%3A%2F%2F%2Fdata%2Fid_rsa&passPhrase=key-secret";
		localStorage.setItem(
			"storageList",
			JSON.stringify([{ storageType: "sftp", url: legacy }]),
		);

		await migrateLegacySftpProfiles();

		expect(JSON.parse(localStorage.getItem("storageList"))).toEqual([]);
		expect(deleteMock).toHaveBeenCalledTimes(1);
	});
});
