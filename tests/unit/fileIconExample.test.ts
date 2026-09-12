import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { afterEach, expect, it } from "vitest";
import fileIcons, { fileIconApi } from "lib/fileIcons";

afterEach(() => fileIcons.resetForTests());

it("loads the Material Icons example through the public API", async () => {
	const root = path.resolve("examples/material-icons");
	// Examples may be omitted from source-only checkouts.
	if (!fs.existsSync(root)) return;
	let init: (base: string) => Promise<void>;
	let unmount: () => void;
	vm.runInNewContext(fs.readFileSync(path.join(root, "main.js"), "utf8"), {
		PLUGIN_DIR: "/plugins",
		acode: {
			require(name: string) {
				if (name === "fileIcons") return fileIconApi;
				if (name === "Url")
					return { join: (...parts: string[]) => parts.join("/") };
				if (name === "fs")
					return (name: string) => ({
						readFile: async () =>
							JSON.parse(
								fs.readFileSync(path.join(root, path.basename(name)), "utf8"),
							),
					});
				throw new Error(name);
			},
			setPluginInit(_id: string, fn: typeof init) {
				init = fn;
			},
			setPluginUnmount(_id: string, fn: typeof unmount) {
				unmount = fn;
			},
		},
	});
	await init!("file:///plugins/material/");
	fileIcons.use("sebastianjnuwu.material.icons", { persist: false });
	expect(fileIcons.resolve("app.js").themeId).toBe(
		"sebastianjnuwu.material.icons",
	);
	expect(
		fileIcons.resolve({ name: "src", kind: "folder", expanded: true }).themeId,
	).toBe("sebastianjnuwu.material.icons");
	unmount!();
	expect(fileIcons.active().id).toBe("builtin");
});
