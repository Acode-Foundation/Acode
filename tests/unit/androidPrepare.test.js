import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { parse } = require("elementtree");
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
		write(
			"config.xml",
			fs.readFileSync(new URL("../../config.xml", import.meta.url), "utf8"),
		);
		const manifest = write(
			"platforms/android/app/src/main/AndroidManifest.xml",
			`
			<manifest xmlns:android="http://schemas.android.com/apk/res/android">
				<application>
					<activity android:name="MainActivity">
						<intent-filter>
							<action android:name="android.intent.action.MAIN" />
							<category android:name="android.intent.category.LAUNCHER" />
						</intent-filter>
					</activity>
					<activity-alias android:name=".MainActivityIconDefault" android:targetActivity=".MainActivity" />
					<activity-alias android:name="other.Alias" android:targetActivity="other.Activity" />
				</application>
			</manifest>`,
		);
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
		const preparedManifest = fs.readFileSync(manifest, "utf8");
		const application = parse(preparedManifest).find("application");
		// The editor activity keeps its own component: the launcher filter is
		// stripped and aliases target it directly, with no launcher indirection.
		expect(application.find("activity").findall("intent-filter")).toHaveLength(
			0,
		);
		const aliases = application.findall("activity-alias");
		expect(aliases).toHaveLength(2);
		expect(aliases.map((alias) => alias.get("android:name"))).toEqual([
			".MainActivityIconDefault",
			"other.Alias",
		]);
		expect(fs.readFileSync(generated, "utf8")).toBe(
			fs.readFileSync(source, "utf8"),
		);
		fs.appendFileSync(source, "\n// subsequent native edit");
		prepare();
		expect(fs.readFileSync(manifest, "utf8")).toBe(preparedManifest);
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

it("keeps every launcher alias pointing at MainActivity without a launcher indirection", () => {
	const config = parse(
		fs.readFileSync(new URL("../../config.xml", import.meta.url), "utf8"),
	);
	const application = config
		.findall(".//config-file")
		.find((element) => element.findall("activity-alias").length);
	const children = application.getchildren();
	expect(children.map((child) => child.tag)).toEqual(
		children.map(() => "activity-alias"),
	);
	expect(children.some((child) => child.tag === "activity")).toBe(false);
	const aliases = application.findall("activity-alias");
	expect(aliases.map((alias) => alias.get("android:name"))).toEqual([
		".MainActivityIconDefault",
		".MainActivityIconPro",
		".MainActivityIconMidnightCircuit",
		".MainActivityIconAuroraPulse",
		".MainActivityIconTerminalGlow",
		".MainActivityIconSolarFlare",
		".MainActivityIconBlueprint",
		".MainActivityIconPixelParty",
		".MainActivityIconPrism",
		".MainActivityIconPorcelain",
		".MainActivityIconTangerine",
		".MainActivityIconTidal",
		".MainActivityIconLilac",
		".MainActivityIconVolt",
		".MainActivityIconCobalt",
		".MainActivityIconGlacier",
	]);
	for (const [index, alias] of aliases.entries()) {
		expect(alias.get("android:targetActivity")).toBe(".MainActivity");
		expect(alias.get("android:enabled")).toBe(index === 0 ? "true" : "false");
		expect(alias.get("android:exported")).toBe("true");
	}
});
