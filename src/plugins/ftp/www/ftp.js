module.exports = {
	connect: function (
		host,
		port,
		username,
		password,
		options,
		onSuccess,
		onFail,
	) {
		if (typeof port != "number") {
			throw new Error("Port must be number");
		}
		port = Number.parseInt(port);

		var connectionMode = "passive";
		var securityType = "ftp";
		var encoding = "utf8";

		if (typeof options === "function") {
			onFail = onSuccess;
			onSuccess = options;
			options = {};
		}

		if (options) {
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

		cordova.exec(onSuccess, onFail, "Ftp", "connect", [
			host,
			port,
			username,
			password,
			connectionMode,
			securityType,
			encoding,
		]);
	},
	listDirectory: function (id, path, onSuccess, onFail) {
		cordova.exec(onSuccess, onFail, "Ftp", "listDirectory", [id, path]);
	},
	execCommand: function (id, command, onSuccess, onFail, args) {
		cordova.exec(onSuccess, onFail, "Ftp", "execCommand", [id, command, args]);
	},
	isConnected: function (id, onSuccess, onFail) {
		cordova.exec(onSuccess, onFail, "Ftp", "isConnected", [id]);
	},
	disconnect: function (id, onSuccess, onFail) {
		cordova.exec(onSuccess, onFail, "Ftp", "disconnect", [id]);
	},
	downloadFile: function (id, remotePath, localPath, onSuccess, onFail) {
		cordova.exec(onSuccess, onFail, "Ftp", "downloadFile", [
			id,
			remotePath,
			localPath,
		]);
	},
	uploadFile: function (id, localPath, remotePath, onSuccess, onFail) {
		cordova.exec(onSuccess, onFail, "Ftp", "uploadFile", [
			id,
			localPath,
			remotePath,
		]);
	},
	deleteFile: function (id, path, onSuccess, onFail) {
		cordova.exec(onSuccess, onFail, "Ftp", "deleteFile", [id, path]);
	},
	deleteDirectory: function (id, path, onSuccess, onFail) {
		cordova.exec(onSuccess, onFail, "Ftp", "deleteDirectory", [id, path]);
	},
	createDirectory: function (id, path, onSuccess, onFail) {
		cordova.exec(onSuccess, onFail, "Ftp", "createDirectory", [id, path]);
	},
	createFile: function (id, path, onSuccess, onFail) {
		cordova.exec(onSuccess, onFail, "Ftp", "createFile", [id, path]);
	},
	getStat: function (id, path, onSuccess, onFail) {
		cordova.exec(onSuccess, onFail, "Ftp", "getStat", [id, path]);
	},
	exists: function (id, path, onSuccess, onFail) {
		cordova.exec(onSuccess, onFail, "Ftp", "exists", [id, path]);
	},
	changeDirectory: function (id, path, onSuccess, onFail) {
		cordova.exec(onSuccess, onFail, "Ftp", "changeDirectory", [id, path]);
	},
	changeToParentDirectory: function (id, onSuccess, onFail) {
		cordova.exec(onSuccess, onFail, "Ftp", "changeToParentDirectory", [id]);
	},
	getWorkingDirectory: function (id, onSuccess, onFail) {
		cordova.exec(onSuccess, onFail, "Ftp", "getWorkingDirectory", [id]);
	},
	rename: function (id, oldPath, newPath, onSuccess, onFail) {
		cordova.exec(onSuccess, onFail, "Ftp", "rename", [id, oldPath, newPath]);
	},
	getKeepAlive: function (id, onSuccess, onFail) {
		cordova.exec(onSuccess, onFail, "Ftp", "getKeepAlive", [id]);
	},
	sendNoOp: function (id, onSuccess, onFail) {
		cordova.exec(onSuccess, onFail, "Ftp", "sendNoOp", [id]);
	},
};
