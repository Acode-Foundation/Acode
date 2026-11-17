import whenAppVisible from "../utils/whenAppVisible";
import type { NativeCallback } from "./bridge";
import bridge from "./bridge";
import httpStream from "./httpStream";
import statusbar from "./statusbar";

const { exec } = bridge("System");

const api = {
	isManageExternalStorageDeclared(
		success: NativeCallback,
		error: NativeCallback,
	) {
		exec(success, error, "isManageExternalStorageDeclared", []);
	},
	hasGrantedStorageManager(success: NativeCallback, error: NativeCallback) {
		exec(success, error, "hasGrantedStorageManager", []);
	},
	requestStorageManager(success: NativeCallback, error: NativeCallback) {
		exec(success, error, "requestStorageManager", []);
	},
	copyToUri(
		srcUri: string,
		destUri: string,
		fileName: string,
		success: NativeCallback,
		error: NativeCallback,
	) {
		exec(success, error, "copyToUri", [srcUri, destUri, fileName]);
	},
	fileExists(
		path: string,
		countSymlinks: boolean,
		success: NativeCallback,
		error: NativeCallback,
	) {
		exec(success, error, "fileExists", [path, String(countSymlinks)]);
	},
	createSymlink(
		target: string,
		linkPath: string,
		success: NativeCallback,
		error: NativeCallback,
	) {
		exec(success, error, "createSymlink", [target, linkPath]);
	},
	writeText(
		path: string,
		content: string | ArrayBuffer,
		success: NativeCallback,
		error: NativeCallback,
	) {
		exec(success, error, "writeText", [path, content]);
	},
	deleteFile(path: string, success: NativeCallback, error: NativeCallback) {
		exec(success, error, "deleteFile", [path]);
	},
	setExec(
		path: string,
		executable: boolean,
		success: NativeCallback,
		error: NativeCallback,
	) {
		exec(success, error, "setExec", [path, String(executable)]);
	},
	getInstaller(success: NativeCallback, error: NativeCallback) {
		exec(success, error, "getInstaller", []);
	},
	shareText(text: string, success: NativeCallback, error: NativeCallback) {
		exec(success, error, "shareText", [text]);
	},
	getNativeLibraryPath(success: NativeCallback, error: NativeCallback) {
		exec(success, error, "getNativeLibraryPath", []);
	},
	getFilesDir(success: NativeCallback, error: NativeCallback) {
		exec(success, error, "getFilesDir", []);
	},
	getRewardStatus(
		success: (status: string | RewardStatus) => void,
		error: OnFail,
	) {
		exec(success, error, "getRewardStatus", []);
	},
	extractAsset(
		assetName: string,
		destinationPath: string,
		success: NativeCallback,
		error: NativeCallback,
	) {
		exec(success, error, "extractAsset", [assetName, destinationPath]);
	},
	getParentPath(path: string, success: NativeCallback, error: NativeCallback) {
		exec(success, error, "getParentPath", [path]);
	},
	listChildren(path: string, success: NativeCallback, error: NativeCallback) {
		exec(success, error, "listChildren", [path]);
	},
	mkdirs(path: string, success: NativeCallback, error: NativeCallback) {
		exec(success, error, "mkdirs", [path]);
	},
	getArch(success: NativeCallback, error: NativeCallback) {
		exec(success, error, "getArch", []);
	},
	clearCache(success: NativeCallback, fail: NativeCallback) {
		return exec(success, fail, "clearCache", []);
	},
	getWebviewInfo(onSuccess: (res: Info) => void, onFail: OnFail) {
		exec(onSuccess, onFail, "get-webkit-info", []);
	},
	isPowerSaveMode(onSuccess: OnSuccessBool, onFail: OnFail) {
		exec(onSuccess, onFail, "is-powersave-mode", []);
	},
	fileAction(
		fileUri: string,
		filename: string,
		action?: string | NativeCallback,
		mimeType?: string | NativeCallback,
		onFail?: NativeCallback,
	) {
		if (typeof action !== "string") {
			onFail = action || function () {};
			action = filename;
			filename = "";
		} else if (typeof mimeType !== "string") {
			onFail = mimeType || function () {};
			mimeType = action;
			action = filename;
			filename = "";
		} else if (typeof onFail !== "function") {
			onFail = function () {};
		}
		action = "android.intent.action." + action;
		exec(function () {}, onFail, "file-action", [
			fileUri,
			filename,
			action,
			mimeType,
		]);
	},
	getAppInfo(onSuccess: (info: AppInfo) => void, onFail: OnFail) {
		exec(onSuccess, onFail, "get-app-info", []);
	},
	addShortcut(shortcut: ShortCut, onSuccess: OnSuccessBool, onFail: OnFail) {
		const { id, label, description, icon, data, action } = shortcut;
		exec(onSuccess, onFail, "add-shortcut", [
			id,
			label,
			description,
			icon,
			action,
			data,
		]);
	},
	removeShortcut(id: string, onSuccess: OnSuccessBool, onFail: OnFail) {
		exec(onSuccess, onFail, "remove-shortcut", [id]);
	},
	pinShortcut(id: string, onSuccess: OnSuccessBool, onFail: OnFail) {
		exec(onSuccess, onFail, "pin-shortcut", [id]);
	},
	pinFileShortcut(
		shortcut: FileShortcut,
		onSuccess: OnSuccessBool,
		onFail: OnFail,
	) {
		exec(onSuccess, onFail, "pin-file-shortcut", [shortcut]);
	},
	manageAllFiles(onSuccess: OnSuccessBool, onFail: OnFail) {
		exec(onSuccess, onFail, "manage-all-files", []);
	},
	getAndroidVersion(onSuccess: (res: Number) => void, onFail: OnFail) {
		exec(onSuccess, onFail, "get-android-version", []);
	},
	isExternalStorageManager(onSuccess: OnSuccessBool, onFail: OnFail) {
		exec(onSuccess, onFail, "is-external-storage-manager", []);
	},
	requestPermission(
		permission: string,
		onSuccess: OnSuccessBool,
		onFail: OnFail,
	) {
		exec(onSuccess, onFail, "request-permission", [permission]);
	},
	requestPermissions(
		permissions: string[],
		onSuccess: OnSuccessBool,
		onFail: OnFail,
	) {
		exec(onSuccess, onFail, "request-permissions", [permissions]);
	},
	hasPermission(permission: string, onSuccess: OnSuccessBool, onFail: OnFail) {
		exec(onSuccess, onFail, "has-permission", [permission]);
	},
	openInBrowser(src: string) {
		exec(null, null, "open-in-browser", [src]);
	},
	/**
	 * Launch an Android application activity.
	 *
	 * @param {string} app - Package name of the application (e.g. `com.example.app`).
	 * @param {string} className - Fully qualified activity class name (e.g. `com.example.app.MainActivity`).
	 * @param {Object<string, (string|number|boolean)>} [extras] - Optional key-value pairs passed as Intent extras.
	 * @param {(message: string) => void} [onSuccess] - Callback invoked when the activity launches successfully.
	 * @param {(error: any) => void} [onFail] - Callback invoked if launching the activity fails.
	 *
	 * @example
	 * System.launchApp(
	 *   "com.example.app",
	 *   "com.example.app.MainActivity",
	 *   {
	 *     user: "example",
	 *     age: 20,
	 *     premium: true
	 *   },
	 *   (msg) => console.log(msg),
	 *   (err) => console.error(err)
	 * );
	 */
	launchApp(
		app: string,
		className: string,
		extras: Record<string, string | number | boolean> | undefined,
		onSuccess: OnSuccessBool | undefined,
		onFail: OnFail | undefined,
	) {
		exec(onSuccess, onFail, "launch-app", [app, className, extras]);
	},
	inAppBrowser(
		url: string,
		title: string,
		showButtons: boolean,
		disableCache: boolean,
	) {
		const myInAppBrowser: {
			onOpenExternalBrowser: NativeCallback;
			onError: NativeCallback;
		} = {
			onOpenExternalBrowser: null,
			onError: null,
		};
		exec(
			function (data: unknown) {
				if (typeof data !== "string") {
					console.warn("System.inAppBrowser: invalid callback payload", data);
					return;
				}
				const separatorIndex = data.indexOf(":");
				if (separatorIndex < 0) {
					console.warn("System.inAppBrowser: malformed callback payload", data);
					return;
				}
				const dataTag = data.slice(0, separatorIndex);
				const dataUrl = data.slice(separatorIndex + 1);
				if (dataTag === "onOpenExternalBrowser") {
					if (typeof myInAppBrowser.onOpenExternalBrowser === "function") {
						myInAppBrowser.onOpenExternalBrowser(dataUrl);
					} else {
						console.warn(
							"System.inAppBrowser: onOpenExternalBrowser handler is not set",
						);
					}
				}
			},
			function (err) {
				if (typeof myInAppBrowser.onError === "function") {
					myInAppBrowser.onError(err);
					return;
				}
				console.warn("System.inAppBrowser error callback not handled", err);
			},
			"in-app-browser",
			[url, title, !!showButtons, disableCache],
		);
		return myInAppBrowser;
	},
	setUiTheme(
		systemBarColor: string,
		theme: object,
		onSuccess: OnSuccessBool,
		onFail: OnFail,
	) {
		const color = systemBarColor.toLowerCase();
		if (color === "#ffffff" || color === "#ffffffff") {
			systemBarColor = "#fffffe";
		}
		exec(
			(out) => {
				statusbar.setBackgroundColor(systemBarColor);
				if (typeof onSuccess === "function") {
					onSuccess(out);
				}
			},
			onFail,
			"set-ui-theme",
			[systemBarColor, theme],
		);
	},
	setIntentHandler(handler: (intent: Intent) => void, onerror: OnFail) {
		exec(
			visibleIntentHandler(handler, onerror),
			onerror,
			"set-intent-handler",
			[],
		);
	},
	getIntent(onSuccess: (intent: Intent) => void, onFail: OnFail) {
		exec(visibleIntentHandler(onSuccess, onFail), onFail, "get-intent", []);
	},
	setInputType(
		type: string,
		onSuccess: NativeCallback,
		onFail: NativeCallback,
	) {
		exec(onSuccess, onFail, "set-input-type", [type]);
	},
	setNativeContextMenuDisabled(
		disabled: boolean,
		onSuccess: (() => void) | undefined,
		onFail: OnFail | undefined,
	) {
		exec(onSuccess, onFail, "set-native-context-menu-disabled", [
			String(!!disabled),
		]);
	},
	/**
	 * Change the app icon at runtime.
	 * @param iconName Icon id, e.g. "midnight_circuit", or "default" to restore the original icon
	 * @param onSuccess
	 * @param onFail
	 */
	setAppIcon(iconName: string, onSuccess: OnSuccessBool, onFail: OnFail) {
		exec(onSuccess, onFail, "set-app-icon", [iconName]);
	},
	getGlobalSetting(
		key: string,
		onSuccess: NativeCallback,
		onFail: NativeCallback,
	) {
		exec(onSuccess, onFail, "get-global-setting", [key]);
	},
	/**
	 * Compare file content with provided text in a background thread.
	 * @param {string} fileUri - The URI of the file to read
	 * @param {string} encoding - The character encoding to use
	 * @param {string} currentText - The text to compare against
	 * @returns {Promise<boolean>} - Resolves to true if content differs, false if same
	 */
	compareFileText(fileUri: string, encoding: string, currentText: string) {
		return new Promise((resolve, reject) => {
			exec(
				function (result) {
					resolve(result === 1);
				},
				reject,
				"compare-file-text",
				[fileUri, encoding, currentText],
			);
		});
	},
	/**
	 * Compare two text strings in a background thread.
	 * @param {string} text1 - First text to compare
	 * @param {string} text2 - Second text to compare
	 * @returns {Promise<boolean>} - Resolves to true if texts differ, false if same
	 */
	compareTexts(text1: string, text2: string) {
		return new Promise((resolve, reject) => {
			exec(
				function (result) {
					resolve(result === 1);
				},
				reject,
				"compare-texts",
				[text1, text2],
			);
		});
	},
	/**
	 * Make an HTTP request and receive the response body as a WHATWG
	 * `ReadableStream` of `Uint8Array` chunks, as bytes arrive from the server.
	 *
	 * The native layer does not buffer the whole response and performs no SSE /
	 * provider specific parsing; it simply forwards raw byte chunks. Chunk
	 * boundaries are arbitrary and may split multi-byte UTF-8 characters or SSE
	 * frames. The consumer is responsible for decoding / parsing the stream.
	 *
	 * @param {string} url - Request URL
	 * @param {Object} [options]
	 * @param {string} [options.method="GET"] - HTTP method
	 * @param {Object<string,string>} [options.headers] - Request headers
	 * @param {string} [options.body] - Request body. Sent as UTF-8 text unless
	 *   `bodyIsBase64` is set, in which case it is decoded from base64.
	 * @param {boolean} [options.bodyIsBase64=false]
	 * @param {boolean} [options.followRedirects=true]
	 * @param {number} [options.connectTimeout=30000] - Connect timeout in ms
	 * @param {number} [options.readTimeout=0] - Read timeout in ms (0 = none)
	 * @param {number} [options.chunkSize=32768] - Requested native chunk size in bytes
	 * @param {AbortSignal} [options.signal] - When aborted, the underlying native
	 *   request is cancelled. If the headers have not yet arrived the returned
	 *   promise rejects with an `AbortError`; otherwise the response stream is
	 *   errored with an `AbortError`.
	 * @returns {Promise<Response>} Resolves with a `Response` whose `body` is a
	 *   `ReadableStream` delivering `Uint8Array` chunks. A 4xx/5xx HTTP status
	 *   is a normal response (not a rejected promise); only transport failures
	 *   reject. Cancelling the returned stream's reader (or aborting
	 *   `options.signal`) cancels the underlying native HTTP request.
	 */
	httpStream,
};
export default api;

function visibleIntentHandler(
	handler: (intent: Intent) => void,
	onFail: OnFail,
) {
	return (intent: Intent) => {
		if (!document.body.classList.contains("loading")) return handler(intent);
		void whenAppVisible()
			.then(() => handler(intent))
			.catch(onFail);
	};
}
