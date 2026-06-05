#!/usr/bin/env node

/**
 * Acode Dev Orchestrator
 *
 * Starts:
 *   1. HTTP static file server (serves www/) + WebSocket reload relay (same port)
 *   2. rspack --watch with DEV_MODE enabled
 *   3. cordova run android (after first successful compilation)
 *   4. File watcher on src/plugins/ for auto plugin reinstall
 *
 * The app loads boot.js from the APK assets; boot.js detects DEV_MODE and
 * fetches the latest main.js / main.css from the dev server over HTTP.
 * A WebSocket connection from the app receives "reload" messages on recompile.
 */

const { spawn, execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const net = require("node:net");
const { WebSocketServer } = require("ws");
const os = require("node:os");

// ─── helpers ────────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, "../..");
const WWW = path.join(ROOT, "www");
const PLUGINS = path.join(ROOT, "src", "plugins");
const PLATFORM_WWW = path.join(ROOT, "platforms", "android", "platform_www");
const MIME = {
	".html": "text/html",
	".js": "application/javascript",
	".mjs": "application/javascript",
	".css": "text/css",
	".json": "application/json",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".map": "application/json",
};

function getLocalIP() {
	const interfaces = os.networkInterfaces();
	for (const iface of Object.values(interfaces)) {
		if (!iface) continue;
		for (const addr of iface) {
			if (addr.family === "IPv4" && !addr.internal) {
				// Prefer 192.168.x.x or 10.x.x.x over other private ranges
				if (
					addr.address.startsWith("192.168.") ||
					addr.address.startsWith("10.")
				) {
					return addr.address;
				}
			}
		}
	}
	// Fallback: any non-internal IPv4
	for (const iface of Object.values(interfaces)) {
		if (!iface) continue;
		for (const addr of iface) {
			if (addr.family === "IPv4" && !addr.internal) {
				return addr.address;
			}
		}
	}
	return "127.0.0.1";
}

function getFreePort() {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.listen(0, () => {
			const port = server.address().port;
			server.close(() => resolve(port));
		});
		server.on("error", reject);
	});
}

function log(label, msg) {
	const reset = "\x1b[0m";
	const green = "\x1b[92m";
	const yellow = "\x1b[93m";
	const blue = "\x1b[94m";
	const colors = { info: blue, ok: green, warn: yellow };
	const c = colors[label] || reset;
	console.log(`  ${c}[${label}]${reset} ${msg}`);
}

function spawnAsync(command, args, options) {
	return new Promise((resolve, reject) => {
		const mergedOptions = { stdio: "inherit", ...options };
		const proc = spawn(command, args, mergedOptions);
		proc.on("close", (code) => {
			if (code === 0) resolve();
			else reject(new Error(`${command} exited with code ${code}`));
		});
		proc.on("error", reject);
	});
}

// ─── self-signed certificate ─────────────────────────────────────────────────

let _cachedCert = null;

function getDevCert() {
	if (_cachedCert) return _cachedCert;

	const certPath = path.join(ROOT, ".dev-cert.pem");
	const keyPath = path.join(ROOT, ".dev-key.pem");

	// Reuse existing cert if available
	if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
		_cachedCert = {
			cert: fs.readFileSync(certPath),
			key: fs.readFileSync(keyPath),
		};
		return _cachedCert;
	}

	// Generate via openssl (available on macOS, Linux, and Git Bash on Windows)
	try {
		execSync(
			`openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 365 -nodes -subj "/CN=acode-dev"`,
			{ stdio: "pipe" },
		);
		_cachedCert = {
			cert: fs.readFileSync(certPath),
			key: fs.readFileSync(keyPath),
		};
		log("ok", "Generated self-signed dev certificate");
		return _cachedCert;
	} catch (_e) {
		// openssl not available
	}

	log("warn", "openssl not found — falling back to HTTP");
	return null;
}

// ─── HTTPS + WebSocket server ─────────────────────────────────────────────────

async function createServer(port) {
	const tls = getDevCert();
	let server;

	if (tls) {
		server = https.createServer(tls, handleRequest);
	} else {
		log("warn", "No TLS certificate — falling back to HTTP");
		log("warn", "Install openssl to enable HTTPS for your dev server");
		const http = require("node:http");
		server = http.createServer(handleRequest);
	}

	const wss = new WebSocketServer({ server });

	wss.on("connection", (ws) => {
		log("info", "App connected via WebSocket");
		ws.on("error", () => {});
	});

	return {
		server,
		wss,
		broadcast: (msg) => broadcast(wss, msg),
		isHttps: !!tls,
		protocol: tls ? "https" : "http",
	};
}

function handleRequest(req, res) {
	let urlPath = req.url.split("?")[0];
	if (urlPath === "/") urlPath = "/index.html";
	const relative = path.normalize(urlPath).replace(/^\/+/, "");
	const filePath = path.join(WWW, relative);
	if (!filePath.startsWith(WWW + path.sep) && filePath !== WWW) {
	if (!filePath.startsWith(WWW)) {
		res.writeHead(403);
		res.end("Forbidden");
		return;
	}

	const ext = path.extname(filePath).toLowerCase();
	const contentType = MIME[ext] || "application/octet-stream";

	fs.readFile(filePath, (err, data) => {
		if (err) {
			res.writeHead(404);
			res.end("Not found");
			return;
		}
		res.writeHead(200, {
			"Content-Type": contentType,
			"Access-Control-Allow-Origin": "*",
			"Cache-Control": "no-cache, no-store, must-revalidate",
		});
		res.end(data);
	});
}

function broadcast(wss, message) {
	if (typeof message !== "string") {
		message = JSON.stringify(message);
	}
	for (const client of wss.clients) {
		if (client.readyState === 1) {
			client.send(message);
		}
	}
}

// ─── cordova helpers ─────────────────────────────────────────────────────────

function ensureCordovaFiles() {
	// Copy cordova.js and any other platform_www files into www/
	// so the dev server can serve them when the app redirects to it.
	if (!fs.existsSync(PLATFORM_WWW)) {
		log("warn", "platform_www not found — skipping cordova file copy");
		return;
	}

	const files = fs.readdirSync(PLATFORM_WWW);
	for (const file of files) {
		const src = path.join(PLATFORM_WWW, file);
		const dest = path.join(WWW, file);
		if (fs.statSync(src).isFile()) {
			// Don't overwrite index.html
			if (file === "index.html") continue;
			fs.copyFileSync(src, dest);
		}
	}
	log("ok", "Copied cordova platform files to www/");
}

async function launchApp(target) {
	if (target) {
		log("info", `Launching app on ${target}...`);
	} else {
		log("info", "Launching app...");
	}

	return new Promise((resolve, reject) => {
		const args = ["run", "android"];
		if (target) args.push("--target", target);
		const proc = spawn("cordova", args, {
			cwd: ROOT,
			stdio: "inherit",
		});

		proc.on("close", (code) => {
			if (code === 0) resolve();
			else reject(new Error(`cordova run android exited with code ${code}`));
		});

		proc.on("error", reject);
	});
}

// ─── rspack watcher ──────────────────────────────────────────────────────────

function startRspackWatch(host, port, proto, onCompiled) {
	log("info", "Starting rspack --watch...");

	const env = {
		...process.env,
		DEV_MODE: "true",
		DEV_HOST: host,
		DEV_PORT: String(port),
		DEV_PROTO: proto,
	};

	const proc = spawn("npx", ["rspack", "--watch", "--mode", "development"], {
		cwd: ROOT,
		env,
		stdio: "pipe",
	});

	let firstCompile = true;

	proc.stdout.on("data", (chunk) => {
		const text = chunk.toString();
		process.stdout.write(text);
		if (text.includes("compiled successfully")) {
		if (text.includes("compiled successfully") || text.includes("compiled")) {
			if (firstCompile) {
				firstCompile = false;
			}
			onCompiled();
		}
	});

	proc.stderr.on("data", (chunk) => {
		process.stderr.write(chunk);
	});

	proc.on("error", (err) => {
		log("warn", `rspack error: ${err.message}`);
	});

	proc.on("close", (code) => {
		if (code !== 0 && code !== null) {
			log("warn", `rspack exited with code ${code}`);
		}
	});

	return proc;
}

// ─── plugin watcher ──────────────────────────────────────────────────────────

let pluginUpdateTimer = null;
const pluginUpdates = new Set();

function startPluginWatcher() {
	let chokidar;
	try {
		chokidar = require("chokidar");
	} catch (_e) {
		log("warn", "chokidar not installed — plugin auto-update disabled");
		return;
	}

	if (!fs.existsSync(PLUGINS)) {
		log("warn", "src/plugins/ not found — plugin watcher skipped");
		return;
	}

	const watcher = chokidar.watch(path.join(PLUGINS, "**", "*"), {
		ignored: /(^|[\/\\])\../, // dotfiles
		persistent: true,
		ignoreInitial: true,
		awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
	});

	watcher.on("change", (filePath) => schedulePluginUpdate(filePath));
	watcher.on("add", (filePath) => schedulePluginUpdate(filePath));
	watcher.on("unlink", (filePath) => schedulePluginUpdate(filePath));

	log("info", "Watching src/plugins/ for changes...");
}

function schedulePluginUpdate(filePath) {
	// Extract top-level plugin dir name from path
	const relative = path.relative(PLUGINS, filePath);
	const pluginDir = relative.split(path.sep)[0];
	if (!pluginDir || pluginDir === "tsconfig.tsbuildinfo") return;

	pluginUpdates.add(pluginDir);

	if (pluginUpdateTimer) clearTimeout(pluginUpdateTimer);
	pluginUpdateTimer = setTimeout(applyPluginUpdates, 2000);
}

async function applyPluginUpdates() {
	if (pluginUpdates.size === 0) return;

	for (const dir of pluginUpdates) {
		const pluginPath = path.join(PLUGINS, dir);
		const pluginXml = path.join(pluginPath, "plugin.xml");

		if (!fs.existsSync(pluginXml)) {
			log("warn", `No plugin.xml in ${dir} — skipping`);
			continue;
		}

		const xml = fs.readFileSync(pluginXml, "utf8");
		const idMatch = /<plugin[^>]*\sid=["']([^"']+)["']/.exec(xml);
		const pluginId = idMatch?.[1];
		if (!pluginId) {
			log("warn", `Could not find plugin id in ${dir}/plugin.xml`);
			continue;
		}

		log("info", `Updating plugin: ${pluginId}`);

		try {
			await spawnAsync("cordova", ["plugin", "remove", pluginId], {
				cwd: ROOT,
			});
		} catch (_e) {
			// Plugin might not be installed yet — that's OK
		}

		try {
			await spawnAsync("cordova", ["plugin", "add", `./src/plugins/${dir}`], {
				cwd: ROOT,
			});
			log("ok", `Plugin ${pluginId} reinstalled`);
		} catch (err) {
			log("warn", `Failed to reinstall plugin ${pluginId}: ${err.message}`);
			continue;
		}
	}

	pluginUpdates.clear();

	// Restart the app after plugin changes (native changes need full restart)
	try {
		const configXml = fs.readFileSync(path.join(ROOT, "config.xml"), "utf8");
		const pkgMatch = /id="([^"]+)"/.exec(configXml);
		const pkg = pkgMatch?.[1];
		if (pkg) {
			log("info", "Restarting app after plugin update...");
			// Need to rebuild APK since native plugin code changed
			await spawnAsync("cordova", ["build", "android"], {
				cwd: ROOT,
			});
			await spawnAsync("adb", ["uninstall", pkg], { stdio: "ignore" });
			await spawnAsync("cordova", ["run", "android"], {
				cwd: ROOT,
			});
		}
	} catch (err) {
		log("warn", `Could not rebuild after plugin update: ${err.message}`);
	}
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
	const args = process.argv.slice(2);
	const platform =
		args.find((a) => /^(android|ios|browser)$/i.test(a)) || "android";
	const target =
		args.find((a) => a.startsWith("--target="))?.split("=")[1] || null;
	const emulator = args.includes("--emulator") || args.includes("-e");

	console.log("\n  ⚡ Acode Dev Mode\n");

	const host = getLocalIP();
	const port = await getFreePort();

	log("info", `Local IP:   ${host}`);
	log("info", `Port:       ${port}`);

	// 1. Ensure cordova files are in www/ for the dev server
	ensureCordovaFiles();

	// 2. Start HTTPS (or HTTP fallback) + WebSocket server
	const { server, broadcast, protocol } = await createServer(port);
	const origin = `${protocol}://${host}:${port}`;
	log("info", `Dev Origin: ${origin}`);
	server.listen(port, () => {
		log("ok", "Dev server started");
	});

	// 3. Start rspack --watch
	let appLaunched = false;

	startRspackWatch(host, port, protocol, () => {
		broadcast("reload");

		if (!appLaunched) {
			appLaunched = true;
			setTimeout(async () => {
				try {
					await launchApp(target);
				} catch (err) {
					log("warn", `Launch failed: ${err.message}`);
				}
			}, 3000); // give APK install time
		}
	});

	// 4. Start plugin file watcher
	startPluginWatcher();

	// Graceful shutdown
	process.on("SIGINT", () => {
		log("info", "Shutting down...");
		server.close();
		process.exit(0);
	});

	process.on("SIGTERM", () => {
		server.close();
		process.exit(0);
	});
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
