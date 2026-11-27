const DEV_MODE = typeof __DEV_MODE__ !== "undefined" && __DEV_MODE__;
const DEV_HOST = typeof __DEV_HOST__ !== "undefined" ? __DEV_HOST__ : "";
const DEV_PORT = typeof __DEV_PORT__ !== "undefined" ? __DEV_PORT__ : "";
const DEV_PROTO = typeof __DEV_PROTO__ !== "undefined" ? __DEV_PROTO__ : "";
const DEV_ORIGIN =
	DEV_HOST && DEV_PORT && DEV_PROTO
		? `${DEV_PROTO}://${DEV_HOST}:${DEV_PORT}`
		: "";

(async () => {
	let assetOrigin = ".";
	if (DEV_MODE && DEV_ORIGIN) {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 3000);
		try {
			const response = await fetch(`${DEV_ORIGIN}/build/main.js`, {
				method: "HEAD",
				cache: "no-store",
				signal: controller.signal,
			});
			if (response.ok) assetOrigin = DEV_ORIGIN;
		} catch (error) {
			console.error("Error setting dev mode", error);
		} finally {
			clearTimeout(timeout);
		}
	}
	await bootApp(assetOrigin);
	if (assetOrigin === DEV_ORIGIN) connectWS();
})();

function loadScript(src) {
	return new Promise((resolve, reject) => {
		const el = document.createElement("script");
		el.src = src;
		el.onload = () => Promise.resolve(window.nativeReady).then(resolve, reject);
		el.onerror = reject;
		document.head.appendChild(el);
	});
}

function loadCSS(href) {
	const el = document.createElement("link");
	el.rel = "stylesheet";
	el.href = href;
	document.head.appendChild(el);
}

function connectWS() {
	const wsProto = DEV_PROTO === "https" ? "wss" : "ws";
	let ws;
	try {
		ws = new WebSocket(`${wsProto}://${DEV_HOST}:${DEV_PORT}`);
	} catch {
		setTimeout(connectWS, 1000);
		return;
	}
	ws.onmessage = ({ data }) => {
		if (data === "reload") location.reload();
	};
	ws.onclose = () => setTimeout(connectWS, 1000);
	ws.onerror = () => {};
}

async function bootApp(origin) {
	await loadScript(`${origin}/build/native.js`);
	loadCSS(`${origin}/build/main.css`);
	loadScript(`${origin}/build/main.js`);
}
