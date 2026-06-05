// boot.js — Entry point loaded by index.html
// Routes between development (HTTP dev server) and production (local assets).
// main.js is never imported directly; it's loaded dynamically so the dev server
// can serve a freshly compiled version on every reload.

(function boot() {
	"use strict";

	var DEV_MODE = typeof __DEV_MODE__ !== "undefined" && __DEV_MODE__;
	var DEV_HOST = typeof __DEV_HOST__ !== "undefined" ? __DEV_HOST__ : "";
	var DEV_PORT = typeof __DEV_PORT__ !== "undefined" ? __DEV_PORT__ : "";
	var DEV_PROTO = typeof __DEV_PROTO__ !== "undefined" ? __DEV_PROTO__ : "";
	var DEV_ORIGIN =
		DEV_HOST && DEV_PORT && DEV_PROTO
			? DEV_PROTO.concat("://", DEV_HOST, ":", DEV_PORT)
			: "";

	function loadScript(src) {
		var script = document.createElement("script");
		script.src = src;
		document.head.appendChild(script);
	}

	function loadCSS(href) {
		var link = document.createElement("link");
		link.rel = "stylesheet";
		link.href = href;
		document.head.appendChild(link);
	}

	if (DEV_MODE && DEV_ORIGIN) {
		// --- Development mode: load everything from the dev server ---
		loadCSS("".concat(DEV_ORIGIN, "/build/main.css"));
		loadScript("".concat(DEV_ORIGIN, "/build/main.js"));

		// WebSocket reload channel
		(function connectWS() {
			var wsProto = DEV_PROTO === "https" ? "wss" : "ws";
			var ws;

			try {
				ws = new WebSocket(
					"".concat(wsProto, "://", DEV_HOST, ":", DEV_PORT),
				);
			} catch (_e) {
				setTimeout(connectWS, 1000);
				return;
			}

			ws.onmessage = function (e) {
				if (e.data === "reload") {
					window.location.reload();
				}
			};

			ws.onclose = function () {
				setTimeout(connectWS, 1000);
			};

			ws.onerror = function () {
				// Will trigger onclose and retry
			};
		})();
	} else {
		// --- Production / fallback: load local bundle ---
		loadCSS("./build/main.css");
		loadScript("./build/main.js");
	}
})();
