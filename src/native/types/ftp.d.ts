interface FtpOptions {
	connectionMode: "passive" | "active";
	securityType: "ftp" | "ftps";
	encoding: "utf8" | "binary";
}

type SuccessCallback = (res: any) => void;
type ErrorCallback = (err: any) => void;

interface Ftp {
	connect(
		host: string,
		port: number,
		username: string,
		password: string,
		options: FtpOptions,
		onSuccess: SuccessCallback,
		onError: ErrorCallback,
	): void;
	listDirectory(
		id: string, // connection id
		path: string,
		onSuccess: SuccessCallback,
		onError: ErrorCallback,
	): void;
	execCommand(
		id: string, // connection id
		command: string,
		onSuccess: SuccessCallback,
		onError: ErrorCallback,
		...args: string[]
	): void;
	isConnected(
		id: string, // connection id
		onSuccess: SuccessCallback,
		onError: ErrorCallback,
	): void;
	disconnect(
		id: string, // connection id
		onSuccess: SuccessCallback,
		onError: ErrorCallback,
	): void;
	downloadFile(
		id: string, // connection id
		remotePath: string,
		localPath: string,
		onSuccess: SuccessCallback,
		onError: ErrorCallback,
	): void;
	uploadFile(
		id: string, // connection id
		localPath: string,
		remotePath: string,
		onSuccess: SuccessCallback,
		onError: ErrorCallback,
	): void;
	deleteFile(
		id: string, // connection id
		remotePath: string,
		onSuccess: SuccessCallback,
		onError: ErrorCallback,
	): void;
	deleteDirectory(
		id: string, // connection id
		remotePath: string,
		onSuccess: SuccessCallback,
		onError: ErrorCallback,
	): void;
	createDirectory(
		id: string, // connection id
		remotePath: string,
		onSuccess: SuccessCallback,
		onError: ErrorCallback,
	): void;
	createFile(
		id: string, // connection id
		remotePath: string,
		onSuccess: SuccessCallback,
		onError: ErrorCallback,
	): void;
	getStat(
		id: string, // connection id
		remotePath: string,
		onSuccess: SuccessCallback,
		onError: ErrorCallback,
	): void;
	exists(
		id: string, // connection id
		remotePath: string,
		onSuccess: SuccessCallback,
		onError: ErrorCallback,
	): void;
	changeDirectory(
		id: string, // connection id
		remotePath: string,
		onSuccess: SuccessCallback,
		onError: ErrorCallback,
	): void;
	changeToParentDirectory(
		id: string, // connection id
		onSuccess: SuccessCallback,
		onError: ErrorCallback,
	): void;
	getWorkingDirectory(
		id: string, // connection id
		onSuccess: SuccessCallback,
		onError: ErrorCallback,
	): void;
	rename(
		id: string, // connection id
		oldPath: string,
		newPath: string,
		onSuccess: SuccessCallback,
		onError: ErrorCallback,
	): void;
	sendNoOp(
		id: string, // connection id
		onSuccess: SuccessCallback,
		onError: ErrorCallback,
	): void;
}

declare const ftp: typeof import("../ftp").default;
