// Installs the polyfills for the whole app and its plugins; main.js relies on
// this bundle loading first.
import "core-js/stable";
import buildInfo, { initializeBuildInfo } from "./buildInfo";
import clipboard from "./clipboard";
import customTabs from "./customTabs";
import device, { initializeDevice } from "./device";
import installFileAPI, { file } from "./file";
import ftp from "./ftp";
import http from "./http/advanced-http";
import installPluginCompatibility from "./pluginCompatibility";
import runtime, { expose, initialize, start } from "./runtime";
import sdcard from "./sdcard";
import createServer from "./server";
import sftp from "./sftp";
import system from "./system";
import executor from "./terminal/Executor";
import terminal from "./terminal/Terminal";
import websocket from "./websocket";

initialize();
Object.assign(runtime, { clipboard, http, file, websocket });
for (const [name, value] of Object.entries({
	BuildInfo: buildInfo,
	CustomTabs: customTabs,
	device,
	ftp,
	sdcard,
	CreateServer: createServer,
	sftp,
	system,
	Terminal: terminal,
	Executor: executor,
}))
	expose(name, value);
const readiness = [
	installFileAPI(expose),
	initializeDevice(),
	initializeBuildInfo(),
];
window.nativeReady = initializeServices();

async function initializeServices() {
	if (__FREE__)
		expose(
			"admob",
			(await import(/* webpackMode: "eager" */ "./admob/admob")).default,
		);
	if (!__FDROID__)
		expose("iap", (await import(/* webpackMode: "eager" */ "./iap")).default);
	installPluginCompatibility();
	void start(readiness).catch((error) =>
		console.error("Native initialization failed", error),
	);
}
