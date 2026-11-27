#!/usr/bin/env node

/**
 * Acode Dev Orchestrator
 *
 * Starts:
 *   1. HTTP static file server (serves the platform bundle) + WebSocket reload relay (same port)
 *   2. rspack --watch with DEV_MODE enabled
 *   3. Acode native build/install (after first successful compilation)
 *   4. File watcher on native sources and JavaScript APIs for rebuilds
 *
 * The app retains its local origin and loads dev scripts when reachable,
 * otherwise using the assets bundled in the app.
 * A WebSocket connection from the app receives "reload" messages on recompile.
 */

const { spawn, execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const net = require("node:net");
const { WebSocketServer } = require("ws");
const os = require("node:os");
const { getWebBundlePath } = require("../config");

// ─── helpers ────────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, "../..");
let currentOptions;
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

function resolveSpawnCommand(command) {
	if (process.platform !== "win32") return command;
	const lower = command.toLowerCase();
	if (lower.endsWith(".cmd") || lower.endsWith(".exe")) return command;
	if (lower === "npx" || lower === "npm") {
		return `${command}.cmd`;
	}
	return command;
}

function buildSpawnEnv(extra = {}) {
	const merged = { ...process.env, ...extra };
	const sanitized = {};

	for (const [key, value] of Object.entries(merged)) {
		if (!key || key.startsWith("=") || value === undefined) continue;
		sanitized[key] = String(value);
	}

	return sanitized;
}

function spawnAsync(command, args, options) {
	return new Promise((resolve, reject) => {
		const mergedOptions = {
			stdio: "inherit",
			...options,
			env: options?.env ? buildSpawnEnv(options.env) : options?.env,
		};
		const proc = spawn(resolveSpawnCommand(command), args, mergedOptions);
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

async function createServer(port, useTLS = true) {
	const tls = useTLS ? getDevCert() : null;
	let server;

	if (tls) {
		server = https.createServer(tls, handleRequest);
	} else {
		if (useTLS) {
			log("warn", "No TLS certificate — falling back to HTTP");
			log("warn", "Install openssl to enable HTTPS for your dev server");
		}
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
	const bundle = getWebBundlePath(currentOptions.platform);
	const filePath = path.join(bundle, relative);
	if (!filePath.startsWith(bundle + path.sep) && filePath !== bundle) {
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

// Native build helpers
async function launchApp(target, platform, emulator) {
	const args = [
		path.join(ROOT, `dev/scripts/${platform}.js`),
		"run",
		"--skip-web",
	];
	if (currentOptions.channel === "fdroid") args.push("fdroid");
	if (currentOptions.device) args.push("--device");
	if (target) args.push(`--target=${target}`);
	if (emulator && platform === "android") args.push("--emulator");
	await spawnAsync(process.execPath, args, { cwd: ROOT });
}

// ─── rspack watcher ──────────────────────────────────────────────────────────

function startRspackWatch(host, port, proto, onCompiled) {
	log("info", "Starting rspack --watch...");

	const env = buildSpawnEnv({
		DEV_MODE: "true",
		ACODE_PLATFORM: currentOptions.platform,
		ACODE_FDROID: String(currentOptions.channel === "fdroid"),
		DEV_HOST: host,
		DEV_PORT: String(port),
		DEV_PROTO: proto,
	});
	const rspackBin = path.join(
		ROOT,
		"node_modules",
		"@rspack",
		"cli",
		"bin",
		"rspack.js",
	);

	const useLocalRspack = fs.existsSync(rspackBin);
	if (!useLocalRspack) {
		log("warn", "Local rspack CLI not found, falling back to npx rspack");
	}

	const proc = useLocalRspack
		? spawn(process.execPath, [rspackBin, "--watch", "--mode", "development"], {
				cwd: ROOT,
				env,
				stdio: "pipe",
			})
		: spawn(
				resolveSpawnCommand("npx"),
				["rspack", "--watch", "--mode", "development"],
				{
					cwd: ROOT,
					env,
					stdio: "pipe",
				},
			);

	let firstCompile = true;

	proc.stdout.on("data", (chunk) => {
		const text = chunk.toString();
		process.stdout.write(text);
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
		log("warn", "rspack watcher failed to start; exiting dev mode");
		process.exit(1);
	});

	proc.on("close", (code) => {
		if (code !== 0 && code !== null) {
			log("warn", `rspack exited with code ${code}`);
		}
	});

	return proc;
}

function watchNative(platform, target, emulator) {
	if (platform === "ios" && !target) return;
	const chokidar = require("chokidar");
	let timer;
	let building = false;
	let pending = false;
	const sources =
		platform === "ios"
			? [
					"platforms/ios/runner",
					"platforms/ios/ads",
					"dev/ios",
					"dev/scripts/iosAds.js",
					"platforms/ios/runner.xcodeproj/project.pbxproj",
					"platforms/ios/Config.xcconfig",
				]
			: ["platforms/android/app/src"];
	const watcher = chokidar.watch(
		sources.map((source) => path.join(ROOT, source)),
		{
			ignoreInitial: true,
			ignored: (file) => file.split(path.sep).includes("bundle"),
			awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
		},
	);
	watcher.on("all", () => {
		pending = true;
		clearTimeout(timer);
		timer = setTimeout(rebuild, 1000);
	});
	async function rebuild() {
		if (building || !pending) return;
		building = true;
		pending = false;
		try {
			await launchApp(target, platform, emulator);
		} catch (error) {
			log("warn", `${platform} rebuild failed: ${error.message}`);
		} finally {
			building = false;
			if (pending) void rebuild();
		}
	}
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
	const args = process.argv.slice(2);
	const platform = (
		args.find((a) => /^(android|ios|browser)$/i.test(a)) || "android"
	).toLowerCase();
	if (platform === "browser")
		throw new Error("Choose android or ios for native development.");
	if (platform === "ios" && process.platform !== "darwin")
		throw new Error("iOS development requires macOS and Xcode.");
	currentOptions = { ...require(`./${platform}`).parseOptions(args), platform };
	const target =
		args.find((a) => a.startsWith("--target="))?.split("=")[1] || null;
	const emulator = args.includes("--emulator") || args.includes("-e");

	console.log("\n  ⚡ Acode Dev Mode\n");

	log(
		"info",
		`Configuring ${currentOptions.targetId} (${currentOptions.variant})...`,
	);

	const simulator = platform === "ios" && !!target;
	const host = simulator ? "127.0.0.1" : getLocalIP();
	const port = await getFreePort();

	log("info", `Local IP:   ${host}`);
	log("info", `Port:       ${port}`);

	// 2. Start HTTPS (or HTTP fallback) + WebSocket server
	const { server, broadcast, protocol } = await createServer(
		port,
		platform !== "ios",
	);
	const origin = `${protocol}://${host}:${port}`;
	log("info", `Dev Origin: ${origin}`);
	server.listen(port, platform === "ios" ? host : undefined, () => {
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
					await launchApp(target, platform, emulator);
				} catch (err) {
					log("warn", `Launch failed: ${err.message}`);
				}
			}, 3000);
		}
	});

	watchNative(platform, target, emulator);

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

if (require.main === module) {
	main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
