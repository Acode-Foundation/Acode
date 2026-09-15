import Module, { createRequire } from "node:module";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

const filesDir = "/data/user/0/com.foxdebug.acode/files";

const state = {
	commands: [],
	listing: "",
	extracted: [],
};

const fakeExec = (success, _error, service, action, args) => {
	const [command] = args || [];
	if (service === "BackgroundExecutor" && action === "exec") {
		state.commands.push(command);
		success(String(command).includes("tar -tf") ? state.listing : "ok");
		return;
	}
	success("ok");
};

// Terminal.js and Executor.js are CommonJS modules using require(), so they are
// loaded through Node's loader rather than Vite's.  Inject the Cordova exec
// bridge at the module loader level.
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
	if (request === "cordova/exec") return fakeExec;
	return originalLoad.call(this, request, parent, isMain);
};

const requireFromTest = createRequire(import.meta.url);
const Terminal = requireFromTest(
	"../../src/plugins/terminal/www/Terminal.js",
);

afterAll(() => {
	Module._load = originalLoad;
});

const ubuntuListing = [
	"ubuntu/",
	"ubuntu/bin/",
	"ubuntu/bin/bash",
	"ubuntu/etc/resolv.conf",
	".downloaded",
	".extracted",
	".configured",
	"axs",
].join("\n");

const alpineListing = [
	"alpine/",
	"alpine/bin/",
	"alpine/bin/busybox",
	".downloaded",
	".extracted",
	".configured",
	"axs",
].join("\n");

describe("terminal backup restore", () => {
	beforeEach(() => {
		state.commands.length = 0;
		state.listing = "";
		state.extracted.length = 0;

		globalThis.cordova = {};

		globalThis.system = {
			getFilesDir: (success) => success(filesDir),
			fileExists: (path, _countSymlinks, success) => {
				const exists =
					path.endsWith("aterm_backup.tar") ||
					path.startsWith(`${filesDir}/ubuntu`) ||
					path === `${filesDir}/.extracted` ||
					path === `${filesDir}/.configured` ||
					path === `${filesDir}/.downloaded`;
				success(exists ? 1 : 0);
			},
			extractTarXz: (source, destination, success) => {
				state.extracted.push({ source, destination });
				success();
			},
		};
	});

	it("rejects a legacy Alpine backup before touching the current install", async () => {
		state.listing = alpineListing;

		await expect(Terminal.restore()).rejects.toThrow(/Alpine/i);

		// The incompatible archive must be detected before any removal happens.
		expect(
			state.commands.some((command) => String(command).includes("rm -rf")),
		).toBe(false);
		expect(state.extracted).toHaveLength(0);
	});

	it("rejects an archive that is not a terminal backup", async () => {
		state.listing = "some/random/file.txt";

		await expect(Terminal.restore()).rejects.toThrow(/not a valid/i);
		expect(state.extracted).toHaveLength(0);
	});

	it("extracts a compatible Ubuntu backup into the files directory", async () => {
		state.listing = ubuntuListing;

		await expect(Terminal.restore()).resolves.toBe("ok");

		expect(
			state.commands.some((command) => String(command).includes("rm -rf")),
		).toBe(true);
		expect(state.extracted).toEqual([
			{ source: `${filesDir}/aterm_backup.tar`, destination: filesDir },
		]);
	});
});
