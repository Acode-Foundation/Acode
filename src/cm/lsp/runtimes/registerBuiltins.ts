import { registerRuntimeProvider } from "../runtimeProviders";
import builtinAlpineRuntimeProvider from "./builtinAlpine";
import externalWebSocketRuntimeProvider from "./externalWebSocket";
import webWorkerRuntimeProvider from "./webWorker";

if (platform.localExecution)
	registerRuntimeProvider(builtinAlpineRuntimeProvider, { replace: true });
registerRuntimeProvider(externalWebSocketRuntimeProvider, { replace: true });
registerRuntimeProvider(webWorkerRuntimeProvider, { replace: true });

import platform from "lib/platform";
