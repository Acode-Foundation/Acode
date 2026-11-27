import type { NativeCallback } from "./bridge";
import bridge from "./bridge";

const { exec } = bridge("Sftp");

const api = {
	exec(
		command: String,
		onSuccess: (res: ExecResult) => void,
		onFail: (err: any) => void,
	) {
		exec(onSuccess, onFail, "exec", [command]);
	},
	connectUsingProfile(
		profileId: String,
		onSuccess: () => void,
		onFail: (err: any) => void,
	) {
		exec(onSuccess, onFail, "connectUsingProfile", [profileId]);
	},
	testProfile(
		profileId: String,
		requestId: String,
		timeout: Number,
		onSuccess: (home: String) => void,
		onFail: (err: any) => void,
	) {
		exec(onSuccess, onFail, "testProfile", [profileId, requestId, timeout]);
	},
	cancelConnection(
		requestId: String,
		onSuccess: () => void,
		onFail: (err: any) => void,
	) {
		exec(onSuccess, onFail, "cancelConnection", [requestId]);
	},
	saveProfile(
		profileId: String | null,
		host: String,
		port: Number,
		username: String,
		authType: String,
		password: String,
		keyFile: String,
		passphrase: String,
		onSuccess: (profileId: String) => void,
		onFail: (err: any) => void,
	) {
		exec(onSuccess, onFail, "saveProfile", [
			profileId,
			host,
			port,
			username,
			authType,
			password,
			keyFile,
			passphrase,
		]);
	},
	editProfile(
		profileId: String | null,
		host: String,
		port: Number,
		username: String,
		authType: String,
		password: String,
		keyFile: String,
		passphrase: String,
		onSuccess: (profile: SftpProfileInfo & { profileId: string }) => void,
		onFail: (err: any) => void,
	) {
		exec(onSuccess, onFail, "editProfile", [
			profileId,
			host,
			port,
			username,
			authType,
			password,
			keyFile,
			passphrase,
		]);
	},
	getProfileInfo(
		profileId: String,
		onSuccess: (profile: SftpProfileInfo & { profileId: string }) => void,
		onFail: (err: any) => void,
	) {
		exec(onSuccess, onFail, "getProfileInfo", [profileId]);
	},
	deleteProfile(
		profileId: String,
		onSuccess: () => void,
		onFail: (err: any) => void,
	) {
		exec(onSuccess, onFail, "deleteProfile", [profileId]);
	},
	getFile(
		filename: String,
		localFilename: String,
		onSuccess: (url: String) => void,
		onFail: (err: any) => void,
	) {
		exec(onSuccess, onFail, "getFile", [filename, localFilename]);
	},
	putFile(
		filename: String,
		localFilename: String,
		onSuccess: (url: String) => void,
		onFail: (err: any) => void,
	) {
		exec(onSuccess, onFail, "putFile", [filename, localFilename]);
	},
	lsDir(path: string, onSuccess: NativeCallback, onFail: NativeCallback) {
		exec(onSuccess, onFail, "lsDir", [path]);
	},
	stat(path: string, onSuccess: NativeCallback, onFail: NativeCallback) {
		exec(onSuccess, onFail, "stat", [path]);
	},
	mkdir(path: string, onSuccess: NativeCallback, onFail: NativeCallback) {
		exec(onSuccess, onFail, "mkdir", [path]);
	},
	rm(
		path: string,
		force: boolean,
		recurse: boolean,
		onSuccess: NativeCallback,
		onFail: NativeCallback,
	) {
		exec(onSuccess, onFail, "rm", [path, force, recurse]);
	},
	createFile(
		path: string,
		content: string | ArrayBuffer,
		onSuccess: NativeCallback,
		onFail: NativeCallback,
	) {
		exec(onSuccess, onFail, "createFile", [path, content]);
	},
	rename(
		oldpath: string,
		newpath: string,
		onSuccess: NativeCallback,
		onFail: NativeCallback,
	) {
		exec(onSuccess, onFail, "rename", [oldpath, newpath]);
	},
	pwd(onSuccess: NativeCallback, onFail: NativeCallback) {
		exec(onSuccess, onFail, "pwd", []);
	},
	close(onSuccess: () => void, onFail: (err: any) => void) {
		exec(onSuccess, onFail, "close", []);
	},
	isConnected(
		onSuccess: (connectionId: String) => void,
		onFail: (err: any) => void,
	) {
		exec(onSuccess, onFail, "isConnected", []);
	},
	openShellUsingProfile(
		profileId: String,
		cols: Number,
		rows: Number,
		onEvent: (event: ShellEvent) => void,
		onFail: (err: any) => void,
	) {
		exec(onEvent, onFail, "openShellUsingProfile", [profileId, cols, rows]);
	},
	writeShell(
		sessionId: String,
		data: String,
		onSuccess: () => void,
		onFail: (err: any) => void,
	) {
		exec(onSuccess, onFail, "writeShell", [sessionId, data]);
	},
	resizeShell(
		sessionId: String,
		cols: Number,
		rows: Number,
		onSuccess: () => void,
		onFail: (err: any) => void,
	) {
		exec(onSuccess, onFail, "resizeShell", [sessionId, cols, rows]);
	},
	closeShell(
		sessionId: String,
		onSuccess: () => void,
		onFail: (err: any) => void,
	) {
		exec(onSuccess, onFail, "closeShell", [sessionId]);
	},
};

export default api;
