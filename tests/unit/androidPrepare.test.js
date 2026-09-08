import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { expect, it } from "vitest";

const require = createRequire(import.meta.url);
const hook = fs.readFileSync(
	new URL("../../hooks/post-process.js", import.meta.url),
	"utf8",
);

it("refreshes stale System plugin Java alongside icons on repeated Android prepares", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "acode-prepare-"));
	const write = (file, content) => {
		const target = path.join(root, file);
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.writeFileSync(target, content);
		return target;
	};
	try {
		write("config.xml", '<widget id="com.foxdebug.acode" />');
		write("build-extras.gradle", "// build configuration");
		write("res/android/drawable/ic_acode_pro.xml", "<vector />");
		const source = write(
			"src/plugins/system/android/com/foxdebug/system/System.java",
			'aliases.put("pro", "MainActivityIconPro");',
		);
		const generated = write(
			"platforms/android/app/src/main/java/com/foxdebug/system/System.java",
			'aliases.put("default", "MainActivityIconDefault");',
		);
		const unrelated = write(
			"platforms/android/app/src/main/java/other/Plugin.java",
			"// other plugin",
		);
		const prepare = () =>
			vm.runInNewContext(hook, {
				__dirname: path.join(root, "hooks"),
				process: { env: { TMPDIR: root } },
				console: { log() {}, warn() {}, error() {} },
				require(id) {
					if (id === "child_process")
						return {
							execSync(command) {
								expect(command).toBe("npm prefix");
								return Buffer.from(root);
							},
						};
					return require(id);
				},
			});
		prepare();
		expect(fs.readFileSync(generated, "utf8")).toBe(
			fs.readFileSync(source, "utf8"),
		);
		fs.appendFileSync(source, "\n// subsequent native edit");
		prepare();
		expect(fs.readFileSync(generated, "utf8")).toBe(
			fs.readFileSync(source, "utf8"),
		);
		expect(fs.readFileSync(unrelated, "utf8")).toBe("// other plugin");
		expect(
			fs.readFileSync(
				path.join(
					root,
					"platforms/android/app/src/main/res/drawable/ic_acode_pro.xml",
				),
				"utf8",
			),
		).toBe("<vector />");
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});
