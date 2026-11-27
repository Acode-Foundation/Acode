import type { NativeCallback } from "./bridge";
import bridge from "./bridge";

const { exec } = bridge("SDcard");

const api = {
	copy(
		srcPathname: string,
		destPathname: string,
		onSuccess: (url: string) => void,
		onFail: (err: any) => void,
	) {
		exec(onSuccess, onFail, "copy", [srcPathname, destPathname]);
	},
	createDir(
		pathname: string,
		dir: string,
		onSuccess: (url: string) => void,
		onFail: (err: any) => void,
	) {
		exec(onSuccess, onFail, "create directory", [pathname, dir]);
	},
	createFile(
		pathname: string,
		file: string,
		onSuccess: (url: string) => void,
		onFail: (err: any) => void,
	) {
		exec(onSuccess, onFail, "create file", [pathname, file]);
	},
	delete(
		pathname: string,
		onSuccess: (url: string) => void,
		onFail: (err: any) => void,
	) {
		exec(onSuccess, onFail, "delete", [pathname]);
	},
	exists(
		pathName: string,
		onSuccess: (exists: "TRUE" | "FALSE") => void,
		onFail: (err: any) => void,
	) {
		exec(onSuccess, onFail, "exists", [pathName]);
	},
	formatUri(
		pathName: string,
		onSuccess: (url: string) => void,
		onFail: (err: any) => void,
	) {
		exec(onSuccess, onFail, "format uri", [pathName]);
	},
	getPath(
		uri: string,
		filename: string,
		onSuccess: (url: string) => void,
		onFail: (err: any) => void,
	) {
		exec(onSuccess, onFail, "get path", [uri, filename]);
	},
	getStorageAccessPermission(
		uuid: string,
		onSuccess: (url: string) => void,
		onFail: (err: any) => void,
	) {
		exec(onSuccess, onFail, "storage permission", [uuid]);
	},
	listStorages(
		onSuccess: (storages: Storage[]) => void,
		onFail: (err: any) => void,
	) {
		exec(onSuccess, onFail, "list volumes", []);
	},
	listDir(
		src: string,
		onSuccess: (list: DirListItem[]) => void,
		onFail: (err: any) => void,
	) {
		exec(onSuccess, onFail, "list directory", [src]);
	},
	move(
		srcPathname: string,
		destPathname: string,
		onSuccess: (url: string) => void,
		onFail: (err: any) => void,
	) {
		exec(onSuccess, onFail, "move", [srcPathname, destPathname]);
	},
	openDocumentFile(
		onSuccess: (url: DocumentFile) => void,
		onFail: (err: any) => void,
		mimeType: string,
	) {
		exec(onSuccess, onFail, "open document file", mimeType ? [mimeType] : []);
	},
	getImage(
		onSuccess: (url: string) => void,
		onFail: (err: any) => void,
		mimeType: string,
	) {
		exec(onSuccess, onFail, "get image", mimeType ? [mimeType] : []);
	},
	rename(
		pathname: string,
		newFilename: string,
		onSuccess: (url: string) => void,
		onFail: (err: any) => void,
	) {
		exec(onSuccess, onFail, "rename", [pathname, newFilename]);
	},
	read(filename: string, onSuccess: NativeCallback, onFail: NativeCallback) {
		exec(onSuccess, onFail, "read", [filename]);
	},
	readAsText(
		filename: string,
		encoding: string,
		onSuccess: NativeCallback,
		onFail: NativeCallback,
	) {
		exec(onSuccess, onFail, "readAsText", [filename, encoding]);
	},
	write(
		filename: string,
		content: string | ArrayBuffer,
		onSuccess: NativeCallback,
		onFail: ((res: "OK") => void) | ((err: any) => void),
	) {
		const isBuffer = content instanceof ArrayBuffer;
		exec(onSuccess, onFail, "write", [filename, content, isBuffer]);
	},
	writeText(
		filename: string,
		content: string | ArrayBuffer,
		encoding: string,
		onSuccess: NativeCallback,
		onFail: NativeCallback,
	) {
		exec(onSuccess, onFail, "writeText", [filename, content, encoding]);
	},
	stats(
		filename: string,
		onSuccess: (stats: Stats) => void,
		onFail: (err: any) => void,
	) {
		exec(onSuccess, onFail, "stats", [filename]);
	},
	watchFile(
		filename: string,
		listener: NativeCallback,
		onFail: NativeCallback,
	) {
		const id = Math.trunc(Date.now() + Math.random() * 1000000) + "";
		exec(listener, onFail, "watch file", [filename, id]);
		return {
			unwatch() {
				exec(null, null, "unwatch file", [id]);
			},
		};
	},
	listEncodings(onSuccess: NativeCallback, onFail: NativeCallback) {
		exec(onSuccess, onFail, "list encodings", []);
	},
	workspaceScan(
		options: Partial<FtpOptions> | NativeCallback,
		onEvent: (event: WorkspaceEvent) => void,
		onFail: (err: any) => void,
	) {
		exec(onEvent, onFail, "workspace scan", [options || {}]);
	},
	workspaceUpdate(
		options: Partial<FtpOptions> | NativeCallback,
		onSuccess: (result: { added: number; removed: number }) => void,
		onFail: (err: any) => void,
	) {
		exec(onSuccess, onFail, "workspace update", [options || {}]);
	},
	workspaceSearch(
		options: Partial<FtpOptions> | NativeCallback,
		onEvent: (event: WorkspaceEvent) => void,
		onFail: (err: any) => void,
	) {
		exec(onEvent, onFail, "workspace search", [options || {}]);
	},
	workspaceQuery(
		options: Partial<FtpOptions> | NativeCallback,
		onSuccess: (result: {
			entries: any[];
			cursor: number | null;
			hasMore: boolean;
		}) => void,
		onFail: (err: any) => void,
	) {
		exec(onSuccess, onFail, "workspace query", [options || {}]);
	},
	workspaceCancel(
		id: string,
		onSuccess: ((res: "OK") => void) | undefined,
		onFail: ((err: any) => void) | undefined,
	) {
		exec(onSuccess, onFail, "workspace cancel", [id]);
	},
	workspaceMarkDirty(
		urls: string[],
		onSuccess: ((res: "OK") => void) | undefined,
		onFail: ((err: any) => void) | undefined,
	) {
		exec(onSuccess, onFail, "workspace mark dirty", [urls || []]);
	},
	workspaceClear(
		roots: string[],
		onSuccess: ((res: "OK") => void) | undefined,
		onFail: ((err: any) => void) | undefined,
	) {
		exec(onSuccess, onFail, "workspace clear", [roots || []]);
	},
};

export default api;
