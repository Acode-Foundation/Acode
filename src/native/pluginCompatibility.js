import base64 from "./base64";
import channel from "./channel";

// Only third-party plugins consume this facade. App code uses Bridge/imports.
export default function installPluginCompatibility(host = window) {
	if (host.cordova) return;
	const bridge = host.Bridge;
	const modules = new Map();
	const legacyChannel = {
		...channel,
		onCordovaReady: channel.onBridgeReady,
		onPluginsReady: channel.onServicesReady,
		waitForInitialization: (name) =>
			channel.waitForInitialization(readinessName(name)),
		initializationComplete: (name) =>
			channel.initializationComplete(readinessName(name)),
	};
	const cordova = {
		plugin: { http: bridge.http },
		plugins: { clipboard: bridge.clipboard },
		file: bridge.file,
		websocket: bridge.websocket,
		platformId: bridge.platformId,
		version: bridge.version,
		platformVersion: bridge.version,
		require: requireModule,
		define: defineModule,
	};
	Object.defineProperty(cordova, "exec", { enumerable: true, value: exec });
	for (const name of [
		"addConstructor",
		"addDocumentEventHandler",
		"addStickyDocumentEventHandler",
		"removeDocumentEventHandler",
		"fireDocumentEvent",
		"fireWindowEvent",
	])
		cordova[name] = (...args) => bridge[name](...args);

	for (const name of ["pause", "resume"])
		host.document.addEventListener(name, (event) =>
			channel[name === "pause" ? "onPause" : "onResume"].fire(event),
		);
	Object.defineProperty(host.device, "cordova", {
		enumerable: true,
		get: () => bridge.version,
	});
	const app = host.navigator.app;
	let pendingNavigation;
	Object.assign(app, {
		loadUrl(url, options = {}) {
			options ??= {};
			pendingNavigation = host.setTimeout(() => {
				if (options.clearHistory) app.clearHistory();
				if (options.openExternal) host.system.openInBrowser(url);
				else host.location.href = url;
			}, options.wait || 0);
		},
		cancelLoadUrl: () => host.clearTimeout(pendingNavigation),
	});
	// Proteus dismisses the Android splash before any plugin can load.
	host.navigator.splashscreen = { show() {}, hide() {} };
	register("cordova", cordova);
	register("cordova/exec", exec);
	register("cordova/channel", legacyChannel);
	register("cordova/base64", base64);
	register("cordova/plugin/android/app", app);
	register("cordova/plugin/android/splashscreen", host.navigator.splashscreen);
	register("cordova/plugin/android/statusbar", host.statusbar);

	for (const [id, value] of Object.entries({
		"cordova-clipboard.Clipboard": bridge.clipboard,
		"cordova-plugin-device.device": host.device,
		"cordova-plugin-server.CreateServer": host.CreateServer,
		"cordova-plugin-ftp.ftp": host.ftp,
		"cordova-plugin-sdcard.sdcard": host.sdcard,
		"cordova-plugin-websocket.WebSocket": bridge.websocket,
		"cordova-plugin-buildinfo.BuildInfo": host.BuildInfo,
		"cordova-plugin-sftp.sftp": host.sftp,
		"com.foxdebug.acode.rk.exec.terminal.Terminal": host.Terminal,
		"com.foxdebug.acode.rk.exec.terminal.Executor": host.Executor,
		"cordova-plugin-iap.iap": host.iap,
		"com.foxdebug.acode.rk.customtabs.CustomTabs": host.CustomTabs,
		"cordova-plugin-advanced-http.http": bridge.http,
		"cordova-plugin-system.system": host.system,
		"admob-plus-cordova.AdMob": host.admob,
	}))
		if (value !== undefined) register(id, value);

	for (const name of [
		"DirectoryEntry",
		"DirectoryReader",
		"Entry",
		"File",
		"FileEntry",
		"FileError",
		"FileReader",
		"FileSystem",
		"FileUploadOptions",
		"FileUploadResult",
		"FileWriter",
		"Flags",
		"LocalFileSystem",
		"Metadata",
		"ProgressEvent",
		"requestFileSystem",
	])
		register(`cordova-plugin-file.${name}`, host[name]);
	register("cordova-plugin-file.fileSystemPaths", { file: bridge.file });
	register("cordova-plugin-file.resolveLocalFileSystemURI", {
		resolveLocalFileSystemURL: host.resolveLocalFileSystemURL,
		resolveLocalFileSystemURI: host.resolveLocalFileSystemURI,
	});
	host.cordova = cordova;

	function exec(success, failure, service, action, args = []) {
		args ||= [];
		if (service === "CordovaHttpPlugin") service = "NativeHttpPlugin";
		if (service === "CoreAndroid" || service === "App") {
			service = "App";
			if (action === "overrideBackbutton") {
				action = "overrideButton";
				args = ["backbutton", args[0]];
			} else if (action === "overrideButton") {
				args = [args[0].replace(/button$/, "") + "button", args[1]];
			} else if (action === "loadUrl" || action === "cancelLoadUrl") {
				app[action](...args);
				success?.();
				return;
			}
		}
		return bridge.exec(success, failure, service, action, args);
	}
	function register(id, exports) {
		modules.set(id, { exports });
	}
	function defineModule(id, factory) {
		if (modules.has(id)) throw new Error(`Module ${id} already defined`);
		modules.set(id, { factory, exports: {} });
	}
	function requireModule(id) {
		const module = modules.get(id);
		if (!module) throw new Error(`Module ${id} not found`);
		if (module.factory) {
			const factory = module.factory;
			delete module.factory;
			factory(
				(name) =>
					requireModule(
						name.startsWith("./")
							? `${id.slice(0, id.lastIndexOf("."))}.${name.slice(2)}`
							: name,
					),
				module.exports,
				module,
			);
		}
		return module.exports;
	}
}

function readinessName(name) {
	if (name === "onCordovaReady") return "onBridgeReady";
	if (name === "onPluginsReady") return "onServicesReady";
	return name;
}
