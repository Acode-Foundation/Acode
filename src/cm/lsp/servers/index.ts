import type { LspServerBundle, LspServerManifest } from "../types";
import { javascriptBundle, javascriptServers } from "./javascript";
import { luauBundle, luauServers } from "./luau";
import { pythonBundle, pythonServers } from "./python";
import { systemsBundle, systemsServers } from "./systems";
import { webBundle, webServers } from "./web";

export const builtinServers: LspServerManifest[] = [
	...javascriptServers,
	...pythonServers,
	...luauServers,
	...webServers,
	...systemsServers,
];

export const builtinServerBundles: LspServerBundle[] = [
	javascriptBundle,
	pythonBundle,
	luauBundle,
	webBundle,
	systemsBundle,
];
