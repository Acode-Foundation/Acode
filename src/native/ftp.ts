import type { NativeCallback } from "./bridge";
import bridge from "./bridge";

const { exec } = bridge("Ftp");

const api = {
	connect(
		host: string,
		port: number,
		username: string,
		password: string,
		options: Partial<FtpOptions> | NativeCallback,
		onSuccess: SuccessCallback,
		onFail: ErrorCallback,
	) {
		if (typeof port !== "number") {
			throw new Error("Port must be number");
		}
		port = Math.trunc(port);
		let connectionMode = "passive";
		let securityType = "ftp";
		let encoding = "utf8";
		if (typeof options === "function") {
			onFail = onSuccess;
			onSuccess = options;
			options = {};
		}
		if (options && typeof options === "object") {
			if (options.connectionMode) {
				connectionMode = options.connectionMode;
			}
			if (options.securityType) {
				securityType = options.securityType;
			}
			if (options.encoding) {
				encoding = options.encoding;
			}
		}
		exec(onSuccess, onFail, "connect", [
			host,
			port,
			username,
			password,
			connectionMode,
			securityType,
			encoding,
		]);
	},
	listDirectory(
		id: string,
		path: string,
		onSuccess: SuccessCallback,
		onFail: ErrorCallback,
	) {
		exec(onSuccess, onFail, "listDirectory", [id, path]);
	},
	execCommand(
		id: string,
		command: string,
		onSuccess: SuccessCallback,
		onFail: ErrorCallback,
		args: string[],
	) {
		exec(onSuccess, onFail, "execCommand", [id, command, args]);
	},
	isConnected(id: string, onSuccess: SuccessCallback, onFail: ErrorCallback) {
		exec(onSuccess, onFail, "isConnected", [id]);
	},
	disconnect(id: string, onSuccess: SuccessCallback, onFail: ErrorCallback) {
		exec(onSuccess, onFail, "disconnect", [id]);
	},
	downloadFile(
		id: string,
		remotePath: string,
		localPath: string,
		onSuccess: SuccessCallback,
		onFail: ErrorCallback,
	) {
		exec(onSuccess, onFail, "downloadFile", [id, remotePath, localPath]);
	},
	uploadFile(
		id: string,
		localPath: string,
		remotePath: string,
		onSuccess: SuccessCallback,
		onFail: ErrorCallback,
	) {
		exec(onSuccess, onFail, "uploadFile", [id, localPath, remotePath]);
	},
	deleteFile(
		id: string,
		path: string,
		onSuccess: SuccessCallback,
		onFail: ErrorCallback,
	) {
		exec(onSuccess, onFail, "deleteFile", [id, path]);
	},
	deleteDirectory(
		id: string,
		path: string,
		onSuccess: SuccessCallback,
		onFail: ErrorCallback,
	) {
		exec(onSuccess, onFail, "deleteDirectory", [id, path]);
	},
	createDirectory(
		id: string,
		path: string,
		onSuccess: SuccessCallback,
		onFail: ErrorCallback,
	) {
		exec(onSuccess, onFail, "createDirectory", [id, path]);
	},
	createFile(
		id: string,
		path: string,
		onSuccess: SuccessCallback,
		onFail: ErrorCallback,
	) {
		exec(onSuccess, onFail, "createFile", [id, path]);
	},
	getStat(
		id: string,
		path: string,
		onSuccess: SuccessCallback,
		onFail: ErrorCallback,
	) {
		exec(onSuccess, onFail, "getStat", [id, path]);
	},
	exists(
		id: string,
		path: string,
		onSuccess: SuccessCallback,
		onFail: ErrorCallback,
	) {
		exec(onSuccess, onFail, "exists", [id, path]);
	},
	changeDirectory(
		id: string,
		path: string,
		onSuccess: SuccessCallback,
		onFail: ErrorCallback,
	) {
		exec(onSuccess, onFail, "changeDirectory", [id, path]);
	},
	changeToParentDirectory(
		id: string,
		onSuccess: SuccessCallback,
		onFail: ErrorCallback,
	) {
		exec(onSuccess, onFail, "changeToParentDirectory", [id]);
	},
	getWorkingDirectory(
		id: string,
		onSuccess: SuccessCallback,
		onFail: ErrorCallback,
	) {
		exec(onSuccess, onFail, "getWorkingDirectory", [id]);
	},
	rename(
		id: string,
		oldPath: string,
		newPath: string,
		onSuccess: SuccessCallback,
		onFail: ErrorCallback,
	) {
		exec(onSuccess, onFail, "rename", [id, oldPath, newPath]);
	},
	getKeepAlive(id: string, onSuccess: NativeCallback, onFail: NativeCallback) {
		exec(onSuccess, onFail, "getKeepAlive", [id]);
	},
	sendNoOp(id: string, onSuccess: SuccessCallback, onFail: ErrorCallback) {
		exec(onSuccess, onFail, "sendNoOp", [id]);
	},
};

export default api;
