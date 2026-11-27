import setupAndroid from "../platforms/android";
import setupIOS from "../platforms/ios";
import channel, { type Channel } from "./channel";
import statusbar from "./statusbar";
import type { NativeBridge } from "./types";

const documentChannels = new Map<string, Channel>();
const nativeAdd = document.addEventListener.bind(document);
const nativeRemove = document.removeEventListener.bind(document);
const runtime: NativeBridge = {
	exec: window.Android ? setupAndroid() : setupIOS(),
	platformId: window.Android ? "android" : "ios",
	version: "1.0.0",
	fireDocumentEvent,
	fireWindowEvent: (name, data = {}) =>
		window.dispatchEvent(Object.assign(new Event(name), data)),
	addConstructor: (listener) => channel.onBridgeReady.subscribe(listener),
	addDocumentEventHandler: (name) => addHandler(name, false),
	addStickyDocumentEventHandler: (name) => addHandler(name, true),
	removeDocumentEventHandler: (name) => {
		documentChannels.delete(name);
	},
};
window.Bridge = runtime;
export default runtime;

export function initialize() {
	for (const button of ["back", "volumeup", "volumedown"]) {
		const name = `${button}button`;
		const events = runtime.addDocumentEventHandler(name);
		events.onHasSubscribersChange = () =>
			runtime.exec(null, null, "App", "overrideButton", [
				name,
				events.numHandlers > 0,
			]);
	}
	document.addEventListener = (
		name: string,
		listener: EventListenerOrEventListenerObject | null,
		options?: boolean | AddEventListenerOptions,
	) => {
		if (!listener) return;
		const event =
			name === "deviceready"
				? channel.onDeviceReady
				: documentChannels.get(name);
		if (event) event.subscribe(listener as EventListener);
		else nativeAdd(name, listener, options);
	};
	document.removeEventListener = (
		name: string,
		listener: EventListenerOrEventListenerObject | null,
		options?: boolean | EventListenerOptions,
	) => {
		if (!listener) return;
		const event =
			name === "deviceready"
				? channel.onDeviceReady
				: documentChannels.get(name);
		if (event) event.unsubscribe(listener as EventListener);
		else nativeRemove(name, listener, options);
	};
	expose("statusbar", statusbar);
	Object.assign(navigator, {
		app: {
			exitApp: () => runtime.exec(null, null, "App", "exitApp"),
			overrideButton: (button: string, enabled: boolean) =>
				runtime.exec(null, null, "App", "overrideButton", [button, enabled]),
			clearCache: () => runtime.exec(null, null, "App", "clearCache"),
			clearHistory: () => runtime.exec(null, null, "App", "clearHistory"),
			overrideBackbutton: (enabled: boolean) =>
				runtime.exec(null, null, "App", "overrideButton", [
					"backbutton",
					enabled,
				]),
			backHistory: () => runtime.exec(null, null, "App", "backHistory"),
		},
	});
}
export async function start(readiness: Promise<unknown>[]) {
	channel.onNativeReady.fire();
	channel.onServicesReady.fire();
	channel.onBridgeReady.fire();
	if (document.readyState !== "loading") channel.onDOMContentLoaded.fire();
	else
		nativeAdd("DOMContentLoaded", () => channel.onDOMContentLoaded.fire(), {
			once: true,
		});
	await Promise.all(readiness);
	channel.join(
		() => fireDocumentEvent("deviceready"),
		channel.deviceReadyChannelsArray,
	);
}
export function expose(name: string, value: unknown) {
	const parts = name.split(".");
	const key = parts.pop()!;
	const parent = parts.reduce<Record<string, unknown>>(
		(object, part) => (object[part] ??= {}) as Record<string, unknown>,
		window as unknown as Record<string, unknown>,
	);
	if (parent[key] === value) return;
	try {
		parent[key] = value;
	} catch {
		/* WebView exposes some native APIs through getters. */
	}
	if (parent[key] !== value)
		Object.defineProperty(parent, key, {
			configurable: true,
			get: () => value,
		});
}
function addHandler(name: string, sticky: boolean) {
	const event = sticky ? channel.createSticky(name) : channel.create(name);
	documentChannels.set(name, event);
	return event;
}
function fireDocumentEvent(name: string, data: Record<string, unknown> = {}) {
	const event = Object.assign(new Event(name), data);
	if (name === "deviceready") {
		document.dispatchEvent(event);
		channel.onDeviceReady.fire(event);
	} else if (documentChannels.has(name))
		documentChannels.get(name)!.fire(event);
	else document.dispatchEvent(event);
}
