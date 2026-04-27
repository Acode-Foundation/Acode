module.exports = {
	copy: function (srcPathname, destPathname, onSuccess, onFail) {
		cordova.exec(onSuccess, onFail, "SDcard", "copy", [
			srcPathname,
			destPathname,
		]);
	},
	createDir: function (pathname, dir, onSuccess, onFail) {
		cordova.exec(onSuccess, onFail, "SDcard", "create directory", [
			pathname,
			dir,
		]);
	},
	createFile: function (pathname, file, onSuccess, onFail) {
		cordova.exec(onSuccess, onFail, "SDcard", "create file", [pathname, file]);
	},
	delete: function (pathname, onSuccess, onFail) {
		cordova.exec(onSuccess, onFail, "SDcard", "delete", [pathname]);
	},
	exists: function (pathName, onSuccess, onFail) {
		cordova.exec(onSuccess, onFail, "SDcard", "exists", [pathName]);
	},
	formatUri: function (pathName, onSuccess, onFail) {
		cordova.exec(onSuccess, onFail, "SDcard", "format uri", [pathName]);
	},
	getPath: function (uri, filename, onSuccess, onFail) {
		cordova.exec(onSuccess, onFail, "SDcard", "get path", [uri, filename]);
	},
	getStorageAccessPermission: function (uuid, onSuccess, onFail) {
		cordova.exec(onSuccess, onFail, "SDcard", "storage permission", [uuid]);
	},
	listStorages: function (onSuccess, onFail) {
		cordova.exec(onSuccess, onFail, "SDcard", "list volumes", []);
	},
	listDir: function (src, onSuccess, onFail) {
		cordova.exec(onSuccess, onFail, "SDcard", "list directory", [src]);
	},
	move: function (srcPathname, destPathname, onSuccess, onFail) {
		cordova.exec(onSuccess, onFail, "SDcard", "move", [
			srcPathname,
			destPathname,
		]);
	},
	openDocumentFile: function (onSuccess, onFail, mimeType) {
		cordova.exec(
			onSuccess,
			onFail,
			"SDcard",
			"open document file",
			mimeType ? [mimeType] : [],
		);
	},
	getImage: function (onSuccess, onFail, mimeType) {
		cordova.exec(
			onSuccess,
			onFail,
			"SDcard",
			"get image",
			mimeType ? [mimeType] : [],
		);
	},
	rename: function (pathname, newFilename, onSuccess, onFail) {
		cordova.exec(onSuccess, onFail, "SDcard", "rename", [
			pathname,
			newFilename,
		]);
	},
	read: function (filename, onSuccess, onFail) {
		cordova.exec(onSuccess, onFail, "SDcard", "read", [filename]);
	},
	write: function (filename, content, onSuccess, onFail) {
		var _isBuffer = content instanceof ArrayBuffer;
		cordova.exec(onSuccess, onFail, "SDcard", "write", [
			filename,
			content,
			_isBuffer,
		]);
	},
	stats: function (filename, onSuccess, onFail) {
		cordova.exec(onSuccess, onFail, "SDcard", "stats", [filename]);
	},
	watchFile: function (filename, listener, onFail) {
		var id = parseInt(Date.now() + Math.random() * 1000000) + "";
		cordova.exec(listener, onFail, "SDcard", "watch file", [filename, id]);
		return {
			unwatch: function () {
				cordova.exec(null, null, "SDcard", "unwatch file", [id]);
			},
		};
	},
	listEncodings: function (onSuccess, onFail) {
		cordova.exec(onSuccess, onFail, "SDcard", "list encodings", []);
	},
};
