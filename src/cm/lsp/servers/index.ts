import type { LspServerBundle, LspServerManifest } from "../types";
import { javascriptBundle, javascriptServers } from "./javascript";
import { luauBundle, luauServers } from "./luau";
import { pythonBundle, pythonServers } from "./python";
import { systemsBundle, systemsServers } from "./systems";
import { tailwindBundle, tailwindServers } from "./tailwind";
import { webBundle, webServers } from "./web";

export const builtinServers: LspServerManifest[] = [
	...javascriptServers,
	...pythonServers,
	...luauServers,
	...webServers,
	...systemsServers,
	...tailwindServers,
];

export const builtinServerBundles: LspServerBundle[] = [
	javascriptBundle,
	pythonBundle,
	luauBundle,
	webBundle,
	systemsBundle,
	tailwindBundle,
];
