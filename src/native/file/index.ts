import bridge from "../bridge";
import {
	createEntry,
	DirectoryEntry,
	DirectoryReader,
	Entry,
	type EntryData,
	FileEntry,
	FileSystem,
	fileExec,
} from "./entries";
import NativeFile from "./File";
import FileError from "./FileError";
import FileReader from "./FileReader";
import FileWriter from "./FileWriter";
import toInternalURL from "./internalUrl";
import Metadata from "./Metadata";
import ProgressEvent from "./ProgressEvent";
import restorePaths from "./restorePaths";
import { FileUploadOptions, FileUploadResult, Flags } from "./transferTypes";

const call = bridge("File");
const fileSystems = new Map<string, FileSystem>();
export const file = Object.assign(
	Object.fromEntries(
		[
			"applicationDirectory",
			"applicationStorageDirectory",
			"dataDirectory",
			"cacheDirectory",
			"externalApplicationStorageDirectory",
			"externalDataDirectory",
			"externalCacheDirectory",
			"externalRootDirectory",
			"tempDirectory",
			"syncedDataDirectory",
			"documentsDirectory",
			"sharedDirectory",
		].map((name) => [name, null]),
	) as Record<string, string | null>,
	{
		/**
		 * The WebView URL of a local path without a native round trip, or null
		 * when only `resolveLocalFileSystemURL` can tell.
		 */
		toInternalURL: (url: string, isDirectory?: boolean) =>
			toInternalURL(fileSystems, url, isDirectory),
	},
);

export default function installFileAPI(
	expose: (name: string, value: unknown) => void,
) {
	const globals = {
		FileUploadOptions,
		FileUploadResult,
		Flags,
		DirectoryEntry,
		DirectoryReader,
		Entry,
		File: NativeFile,
		FileEntry,
		FileError,
		FileReader,
		FileSystem,
		FileWriter,
		Metadata,
		ProgressEvent,
		LocalFileSystem: { TEMPORARY: 0, PERSISTENT: 1 },
		TEMPORARY: 0,
		PERSISTENT: 1,
		requestFileSystem,
		resolveLocalFileSystemURL,
		resolveLocalFileSystemURI: resolveLocalFileSystemURL,
	};
	for (const [name, value] of Object.entries(globals)) expose(name, value);
	return call<Record<string, string | null>>("requestAllPaths").then(
		async (paths) => {
			if (Bridge.platformId === "ios")
				restorePaths(
					await call<Parameters<typeof restorePaths>[0]>("getPathReplacements"),
				);
			return Object.assign(file, paths);
		},
	);
}

export function requestFileSystem(
	type: number,
	size: number,
	success?: (filesystem: FileSystem) => void,
	failure?: (error: FileError) => void,
) {
	if (type < 0) {
		failure?.(new FileError(FileError.SYNTAX_ERR));
		return;
	}
	fileExec<{ name: string; root: EntryData }>(
		"requestFileSystem",
		[type, size],
		(data) => {
			if (!data) {
				failure?.(new FileError(FileError.NOT_FOUND_ERR));
				return;
			}
			getFileSystem(data.name).then(
				(fs) => success?.(fs ?? new FileSystem(data.name, data.root)),
				failure,
			);
		},
		failure,
	);
}
export function resolveLocalFileSystemURL(
	uri: string,
	success?: (entry: Entry) => void,
	failure?: (error: FileError) => void,
) {
	if (!uri || uri.split(":").length > 2) {
		setTimeout(() => failure?.(new FileError(FileError.ENCODING_ERR)), 0);
		return;
	}
	fileExec<EntryData>(
		"resolveLocalFileSystemURI",
		[uri],
		(data) => {
			if (!data) {
				failure?.(new FileError(FileError.NOT_FOUND_ERR));
				return;
			}
			const name =
				data.filesystemName ||
				(typeof data.filesystem === "object" && data.filesystem.name) ||
				(data.filesystem === 1 ? "persistent" : "temporary");
			getFileSystem(name).then(
				(fs) =>
					success?.(
						createEntry(
							data,
							fs ?? new FileSystem(name, { name: "", fullPath: "/" }),
						),
					),
				failure,
			);
		},
		failure,
	);
}
async function getFileSystem(name: string) {
	if (!fileSystems.size) {
		const roots = await call<EntryData[]>("requestAllFileSystems");
		for (const root of roots)
			if (root?.filesystemName)
				fileSystems.set(
					root.filesystemName,
					new FileSystem(root.filesystemName, root),
				);
	}
	return fileSystems.get(name);
}
