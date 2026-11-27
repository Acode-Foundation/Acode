// Adapted file APIs; Apache-2.0. See licenses/file-LICENSE and file-NOTICE.
import exec from "../exec";
import NativeFile from "./File";
import FileError from "./FileError";
import FileWriter from "./FileWriter";
import Metadata from "./Metadata";

type Success<T> = ((value: T) => void) | null | undefined;
type Failure = Success<FileError>;
export interface EntryData {
	name?: string;
	fullPath?: string;
	nativeURL?: string;
	isDirectory?: boolean;
	filesystemName?: string;
	filesystem?: { name: string } | number;
}
export interface FileFlags {
	create?: boolean;
	exclusive?: boolean;
}

export class Entry {
	constructor(
		public isFile = false,
		public isDirectory = false,
		public name = "",
		public fullPath = "",
		public filesystem: FileSystem | null = null,
		public nativeURL: string | null = null,
	) {}
	getMetadata(success?: Success<Metadata>, failure?: Failure) {
		fileExec<{ size: number; lastModifiedDate: number }>(
			"getFileMetadata",
			[this.toInternalURL()],
			(value) =>
				success?.(
					new Metadata({
						size: value.size,
						modificationTime: value.lastModifiedDate,
					}),
				),
			failure,
		);
	}
	setMetadata(
		success: Success<void>,
		failure: Failure,
		metadata: Record<string, unknown>,
	) {
		fileExec("setMetadata", [this.toInternalURL(), metadata], success, failure);
	}
	moveTo(
		parent: DirectoryEntry,
		name?: string,
		success?: Success<Entry>,
		failure?: Failure,
	) {
		this.transfer("moveTo", parent, name, success, failure);
	}
	copyTo(
		parent: DirectoryEntry,
		name?: string,
		success?: Success<Entry>,
		failure?: Failure,
	) {
		this.transfer("copyTo", parent, name, success, failure);
	}
	toInternalURL() {
		return (
			this.filesystem?.format(this.fullPath, this.nativeURL ?? "") ??
			this.fullPath
		);
	}
	toURL() {
		return location.origin.includes("file://")
			? this.nativeURL
			: this.toInternalURL();
	}
	toNativeURL() {
		return this.toURL();
	}
	toURI(mimeType?: string) {
		return this.toURL();
	}
	remove(success?: Success<void>, failure?: Failure) {
		fileExec("remove", [this.toInternalURL()], success, failure);
	}
	getParent(success?: Success<DirectoryEntry>, failure?: Failure) {
		fileExec<EntryData>(
			"getParent",
			[this.toInternalURL()],
			(data) =>
				success?.(
					new DirectoryEntry(
						data.name,
						data.fullPath,
						this.filesystem,
						data.nativeURL,
					),
				),
			failure,
		);
	}
	private transfer(
		action: string,
		parent: DirectoryEntry,
		name?: string,
		success?: Success<Entry>,
		failure?: Failure,
	) {
		if (!parent) throw new TypeError("A parent directory is required");
		fileExec<EntryData>(
			action,
			[this.toInternalURL(), parent.toInternalURL(), name || this.name],
			(data) => {
				if (!data) {
					failure?.(new FileError(FileError.NOT_FOUND_ERR));
					return;
				}
				const fsName =
					data.filesystemName ||
					(typeof data.filesystem === "object" && data.filesystem.name) ||
					parent.filesystem?.name ||
					"";
				success?.(
					createEntry(
						data,
						new FileSystem(fsName, { name: "", fullPath: "/" }),
					),
				);
			},
			failure,
		);
	}
}

export class DirectoryEntry extends Entry {
	constructor(
		name = "",
		fullPath = "",
		filesystem: FileSystem | null = null,
		nativeURL: string | null = null,
	) {
		super(
			false,
			true,
			name,
			fullPath && !fullPath.endsWith("/") ? `${fullPath}/` : fullPath,
			filesystem,
			nativeURL && !nativeURL.endsWith("/") ? `${nativeURL}/` : nativeURL,
		);
	}
	createReader() {
		return new DirectoryReader(this.toInternalURL());
	}
	getDirectory(
		path: string,
		options?: FileFlags | null,
		success?: Success<DirectoryEntry>,
		failure?: Failure,
	) {
		fileExec<EntryData>(
			"getDirectory",
			[this.toInternalURL(), path, options],
			(data) =>
				success?.(
					new DirectoryEntry(
						data.name,
						data.fullPath,
						this.filesystem,
						data.nativeURL,
					),
				),
			failure,
		);
	}
	getFile(
		path: string,
		options?: FileFlags | null,
		success?: Success<FileEntry>,
		failure?: Failure,
	) {
		fileExec<EntryData>(
			"getFile",
			[this.toInternalURL(), path, options],
			(data) =>
				success?.(
					new FileEntry(
						data.name,
						data.fullPath,
						this.filesystem,
						data.nativeURL,
					),
				),
			failure,
		);
	}
	removeRecursively(success?: Success<void>, failure?: Failure) {
		fileExec("removeRecursively", [this.toInternalURL()], success, failure);
	}
}

export class FileEntry extends Entry {
	constructor(
		name = "",
		fullPath = "",
		filesystem: FileSystem | null = null,
		nativeURL: string | null = null,
	) {
		super(
			true,
			false,
			name,
			fullPath.replace(/\/$/, ""),
			filesystem,
			nativeURL?.replace(/\/$/, "") ?? null,
		);
	}
	createWriter(success?: Success<FileWriter>, failure?: Failure) {
		this.file((file) => {
			const writer = new FileWriter(file);
			if (!writer.localURL)
				failure?.(new FileError(FileError.INVALID_STATE_ERR));
			else success?.(writer);
		}, failure);
	}
	file(success?: Success<NativeFile>, failure?: Failure) {
		const url = this.toInternalURL();
		fileExec<{
			name: string;
			type: string;
			lastModifiedDate: number;
			size: number;
		}>(
			"getFileMetadata",
			[url],
			(data) =>
				success?.(
					new NativeFile(
						data.name,
						url,
						data.type,
						data.lastModifiedDate,
						data.size,
					),
				),
			failure,
		);
	}
}

export class DirectoryReader {
	private hasReadEntries = false;
	constructor(public localURL: string | null = null) {}
	readEntries(success: (entries: Entry[]) => void, failure?: Failure) {
		if (this.hasReadEntries) {
			success([]);
			return;
		}
		fileExec<EntryData[]>(
			"readEntries",
			[this.localURL],
			(data) => {
				this.hasReadEntries = true;
				success(
					data.map((entry) =>
						createEntry(entry, new FileSystem(entry.filesystemName ?? "")),
					),
				);
			},
			failure,
		);
	}
}

export class FileSystem {
	root: DirectoryEntry;
	constructor(
		public name: string,
		root?: EntryData,
	) {
		this.root = new DirectoryEntry(
			root?.name ?? name,
			root?.fullPath ?? "/",
			this,
			root?.nativeURL,
		);
	}
	static encodeURIPath(path: string) {
		return encodeURI(path).replace(/#/g, "%23").replace(/\?/g, "%3F");
	}
	format(fullPath: string, nativeURL: string) {
		let path: string;
		if (nativeURL.startsWith("content://"))
			path = nativeURL.slice("content:/".length);
		else {
			path = FileSystem.encodeURIPath(fullPath);
			if (!path.startsWith("/")) path = `/${path}`;
			path += /\?.*/.exec(nativeURL)?.[0] ?? "";
		}
		const origin =
			location.origin === "null"
				? `${location.protocol}//${location.host}`
				: location.origin;
		return `${origin}/__cdvfile_${this.name}__${path}`;
	}
	["__format__"](path: string, url: string) {
		return this.format(path, url);
	}
	toJSON() {
		return `<FileSystem: ${this.name}>`;
	}
}

export function createEntry(data: EntryData, filesystem: FileSystem): Entry {
	return data.isDirectory
		? new DirectoryEntry(data.name, data.fullPath, filesystem, data.nativeURL)
		: new FileEntry(data.name, data.fullPath, filesystem, data.nativeURL);
}
export function fileExec<T>(
	action: string,
	args: unknown[],
	success?: Success<T>,
	failure?: Failure,
) {
	exec(
		success,
		(code) => failure?.(new FileError(Number(code))),
		"File",
		action,
		args,
	);
}
