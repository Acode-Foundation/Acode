import type { NativeExec } from "./bridge";
import type { Channel } from "./channel";

export interface NativeBridge {
	exec: NativeExec;
	platformId: string;
	version: string;
	fireDocumentEvent(name: string, data?: Record<string, unknown>): void;
	fireWindowEvent(name: string, data?: Record<string, unknown>): void;
	addConstructor(listener: () => void): void;
	addDocumentEventHandler(name: string): Channel;
	addStickyDocumentEventHandler(name: string): Channel;
	removeDocumentEventHandler(name: string): void;
	file?: Record<string, string | null> & {
		toInternalURL(url: string, isDirectory?: boolean): string | null;
	};
	clipboard?: typeof import("./clipboard").default;
	http?: typeof import("./http/advanced-http").default;
	websocket?: typeof import("./websocket").default;
}
