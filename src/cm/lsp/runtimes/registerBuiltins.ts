import { registerRuntimeProvider } from "../runtimeProviders";
import builtinAlpineRuntimeProvider from "./builtinAlpine";
import externalWebSocketRuntimeProvider from "./externalWebSocket";

registerRuntimeProvider(builtinAlpineRuntimeProvider, { replace: true });
registerRuntimeProvider(externalWebSocketRuntimeProvider, { replace: true });
