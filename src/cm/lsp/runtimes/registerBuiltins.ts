import { registerRuntimeProvider } from "../runtimeProviders";
import builtinUbuntuRuntimeProvider from "./builtinUbuntu";
import externalWebSocketRuntimeProvider from "./externalWebSocket";
import webWorkerRuntimeProvider from "./webWorker";

registerRuntimeProvider(builtinUbuntuRuntimeProvider, { replace: true });
registerRuntimeProvider(externalWebSocketRuntimeProvider, { replace: true });
registerRuntimeProvider(webWorkerRuntimeProvider, { replace: true });
