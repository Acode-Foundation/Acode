import type { NativeBridge } from "./types";
import type { AndroidHost } from "../platforms/android";
import type { IOSReply } from "../platforms/ios";

declare global {
	const Bridge: NativeBridge;
	const __FREE__: boolean;
	const __FDROID__: boolean;
	const IS_IOS: boolean;
	const IS_ANDROID: boolean;
	const PLATFORM: "ios" | "android";
	const ADMOB_APP_ID: string;
	const ADMOB_BANNER_ID: string;
	const ADMOB_INTERSTITIAL_ID: string;
	const ADMOB_REWARDED_ID: string;
	const ADMOB_APP_OPEN_ID: string;
	interface Window {
		toast: typeof import("../components/toast").default;
		Bridge: NativeBridge;
		Android: AndroidHost;
		iOS: { callback(reply: IOSReply): void };
		webkit: {
			messageHandlers: {
				exec: {
					postMessage(message: {
						service: string;
						action: string;
						args: string;
						id: number;
					}): void;
				};
			};
		};
		nativeReady: Promise<void>;
	}
}
