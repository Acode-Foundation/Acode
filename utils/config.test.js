const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
	ADMOB_PLUGIN_ID,
	ID_FREE,
	ID_PAID,
	LEGACY_CONSENT_PLUGIN_ID,
	configureProject,
	getAdmobSyncPlan,
} = require("./config");

const TRACKED_VARIANT_FILES = [
	"package.json",
	"package-lock.json",
	"config.xml",
	"res/android/values/ic_launcher_background.xml",
];

function createFixture({
	id,
	admobInstalled = false,
	legacyConsentInstalled = false,
	dependencyPlugins = [],
	cordovaPlugins = [],
	configPlugins = [],
	bundleExists = true,
}) {
	const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "acode-config-"));
	const write = (relativePath, contents = "") => {
		const filePath = path.join(rootDir, relativePath);
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, contents);
	};
	const dependencies = Object.fromEntries(
		dependencyPlugins.map((pluginId) => [pluginId, "1.0.0"]),
	);
	const pluginDeclarations = configPlugins
		.map((pluginId) => `  <plugin name="${pluginId}" spec="1.0.0" />`)
		.join("\n");

	write(
		"config.xml",
		`<widget id="${id}" version="1.0.0">\n${pluginDeclarations}\n</widget>\n`,
	);
	write(
		"package.json",
		`${JSON.stringify(
			{
				name: "acode-config-test",
				cordova: {
					plugins: Object.fromEntries(
						cordovaPlugins.map((pluginId) => [pluginId, {}]),
					),
				},
				dependencies,
			},
			undefined,
			2,
		)}\n`,
	);
	write(
		"package-lock.json",
		`${JSON.stringify(
			{
				name: "acode-config-test",
				lockfileVersion: 3,
				packages: {
					"": {
						name: "acode-config-test",
						dependencies: { ...dependencies },
					},
					...Object.fromEntries(
						dependencyPlugins.map((pluginId) => [
							`node_modules/${pluginId}`,
							{ version: "1.0.0" },
						]),
					),
				},
			},
			undefined,
			2,
		)}\n`,
	);
	write(".babelrc", '{"compact":false}\n');
	write(
		"res/android/values/ic_launcher_background.xml",
		id === ID_FREE
			? `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#ffffff</color>
    <color name="ic_splash_background">#313131</color>
</resources>`
			: `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#3a3e54</color>
    <color name="ic_splash_background">#3a3e54</color>
</resources>`,
	);
	if (bundleExists) write("src/plugins/admob/www/admob.js", "bundle");
	if (admobInstalled) write(`plugins/${ADMOB_PLUGIN_ID}/plugin.xml`, "plugin");
	if (legacyConsentInstalled) {
		write(`plugins/${LEGACY_CONSENT_PLUGIN_ID}/plugin.xml`, "plugin");
	}

	function removeDependency(pluginId) {
		const packagePath = path.join(rootDir, "package.json");
		const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
		for (const sectionName of [
			"dependencies",
			"devDependencies",
			"optionalDependencies",
		]) {
			delete packageJson[sectionName]?.[pluginId];
		}
		write("package.json", `${JSON.stringify(packageJson, undefined, 2)}\n`);

		const lockPath = path.join(rootDir, "package-lock.json");
		const packageLock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
		for (const sectionName of [
			"dependencies",
			"devDependencies",
			"optionalDependencies",
		]) {
			delete packageLock.packages?.[""]?.[sectionName]?.[pluginId];
		}
		delete packageLock.packages?.[`node_modules/${pluginId}`];
		write(
			"package-lock.json",
			`${JSON.stringify(packageLock, undefined, 2)}\n`,
		);
	}

	return {
		rootDir,
		commandRunner(commands) {
			return async (command, args) => {
				commands.push([command, ...args]);
				if (command === "npm" && args[0] === "uninstall") {
					removeDependency(args[1]);
					return;
				}
				if (command !== "cordova" || args[0] !== "plugin") return;

				if (args[1] === "remove") {
					fs.rmSync(path.join(rootDir, "plugins", args[2]), {
						recursive: true,
						force: true,
					});
					if (args.includes("--save")) removeDependency(args[2]);
				} else if (args[1] === "add") {
					write(`plugins/${ADMOB_PLUGIN_ID}/plugin.xml`, "plugin");
				}
			};
		},
		read(relativePath) {
			return fs.readFileSync(path.join(rootDir, relativePath), "utf8");
		},
		snapshot() {
			return Object.fromEntries(
				TRACKED_VARIANT_FILES.map((relativePath) => [
					relativePath,
					fs.readFileSync(path.join(rootDir, relativePath), "utf8"),
				]),
			);
		},
		remove() {
			fs.rmSync(rootDir, { recursive: true });
		},
	};
}

function pluginState(overrides = {}) {
	return {
		installed: false,
		dependencyDeclared: false,
		cordovaPackageDeclared: false,
		configDeclared: false,
		...overrides,
	};
}

test("plans transient AdMob removal without saving metadata", () => {
	const actions = getAdmobSyncPlan({
		variant: "free",
		bundleExists: true,
		admobState: pluginState({ installed: true }),
	});

	assert.deepEqual(
		actions.map(({ command, args }) => [command, ...args]),
		[
			["cordova", "plugin", "remove", ADMOB_PLUGIN_ID, "--nosave"],
			["cordova", "plugin", "add", "src/plugins/admob", "--nosave"],
		],
	);
});

test("plans saved removal only for installed dependency state", () => {
	const actions = getAdmobSyncPlan({
		variant: "paid",
		bundleExists: true,
		admobState: pluginState({
			installed: true,
			dependencyDeclared: true,
		}),
		legacyConsentState: pluginState({
			installed: true,
			dependencyDeclared: true,
		}),
	});

	assert.deepEqual(
		actions.map(({ command, args }) => [command, ...args]),
		[
			["cordova", "plugin", "remove", LEGACY_CONSENT_PLUGIN_ID, "--save"],
			["cordova", "plugin", "remove", ADMOB_PLUGIN_ID, "--save"],
		],
	);
});

test("free builds reinstall transient AdMob without changing tracked metadata", async (t) => {
	const fixture = createFixture({
		id: ID_FREE,
		admobInstalled: true,
	});
	t.after(fixture.remove);
	const before = fixture.snapshot();
	const commands = [];

	const result = await configureProject({
		rootDir: fixture.rootDir,
		variant: "free",
		commandRunner: fixture.commandRunner(commands),
	});

	assert.equal(result.identityChanged, false);
	assert.deepEqual(commands, [
		["cordova", "plugin", "remove", ADMOB_PLUGIN_ID, "--nosave"],
		["cordova", "plugin", "add", "src/plugins/admob", "--nosave"],
	]);
	assert.deepEqual(fixture.snapshot(), before);
	assert.equal(
		result.actions.every(
			(action) => action.env?.NPM_CONFIG_LEGACY_PEER_DEPS === "true",
		),
		true,
	);
});

test("paid builds remove transient AdMob and refresh changed identity", async (t) => {
	const fixture = createFixture({
		id: ID_FREE,
		admobInstalled: true,
	});
	t.after(fixture.remove);
	fs.mkdirSync(path.join(fixture.rootDir, "platforms/android"), {
		recursive: true,
	});
	const commands = [];

	const result = await configureProject({
		rootDir: fixture.rootDir,
		variant: "paid",
		commandRunner: fixture.commandRunner(commands),
	});

	assert.equal(result.identityChanged, true);
	assert.match(fixture.read("config.xml"), new RegExp(`id="${ID_PAID}"`));
	assert.deepEqual(commands, [
		["cordova", "plugin", "remove", ADMOB_PLUGIN_ID, "--nosave"],
		["npm", "run", "clean"],
	]);
});

test("free and paid builds remove installed saved legacy consent", async (t) => {
	for (const variant of ["free", "paid"]) {
		const fixture = createFixture({
			id: variant === "free" ? ID_FREE : ID_PAID,
			legacyConsentInstalled: true,
			dependencyPlugins: [LEGACY_CONSENT_PLUGIN_ID],
			cordovaPlugins: [LEGACY_CONSENT_PLUGIN_ID],
			configPlugins: [LEGACY_CONSENT_PLUGIN_ID],
		});
		t.after(fixture.remove);
		const commands = [];

		await configureProject({
			rootDir: fixture.rootDir,
			variant,
			commandRunner: fixture.commandRunner(commands),
		});

		assert.deepEqual(commands[0], [
			"cordova",
			"plugin",
			"remove",
			LEGACY_CONSENT_PLUGIN_ID,
			"--save",
		]);
		assert.doesNotMatch(
			`${fixture.read("package.json")}${fixture.read("package-lock.json")}${fixture.read("config.xml")}`,
			/cordova-plugin-consent/,
		);
	}
});

test("dependency-only plugin state is removed through npm", async (t) => {
	const fixture = createFixture({
		id: ID_PAID,
		dependencyPlugins: [LEGACY_CONSENT_PLUGIN_ID, ADMOB_PLUGIN_ID],
	});
	t.after(fixture.remove);
	const commands = [];

	await configureProject({
		rootDir: fixture.rootDir,
		variant: "paid",
		commandRunner: fixture.commandRunner(commands),
	});

	assert.deepEqual(commands, [
		[
			"npm",
			"uninstall",
			LEGACY_CONSENT_PLUGIN_ID,
			"--save",
			"--ignore-scripts",
			"--no-audit",
			"--no-fund",
		],
		[
			"npm",
			"uninstall",
			ADMOB_PLUGIN_ID,
			"--save",
			"--ignore-scripts",
			"--no-audit",
			"--no-fund",
		],
	]);
	assert.doesNotMatch(
		`${fixture.read("package.json")}${fixture.read("package-lock.json")}`,
		/cordova-plugin-consent|admob-plus-cordova/,
	);
});

test("declaration-only state is cleaned without package commands", async (t) => {
	const fixture = createFixture({
		id: ID_PAID,
		cordovaPlugins: [LEGACY_CONSENT_PLUGIN_ID, ADMOB_PLUGIN_ID],
		configPlugins: [LEGACY_CONSENT_PLUGIN_ID, ADMOB_PLUGIN_ID],
	});
	t.after(fixture.remove);
	const packageLockBefore = fixture.read("package-lock.json");
	const commands = [];

	await configureProject({
		rootDir: fixture.rootDir,
		variant: "paid",
		commandRunner: fixture.commandRunner(commands),
	});

	assert.deepEqual(commands, []);
	assert.doesNotMatch(
		`${fixture.read("package.json")}${fixture.read("config.xml")}`,
		/cordova-plugin-consent|admob-plus-cordova/,
	);
	assert.equal(fixture.read("package-lock.json"), packageLockBefore);
});

test("repeated free configuration converges to identical tracked files", async (t) => {
	const fixture = createFixture({ id: ID_FREE });
	t.after(fixture.remove);

	await configureProject({
		rootDir: fixture.rootDir,
		variant: "free",
		commandRunner: fixture.commandRunner([]),
	});
	const converged = fixture.snapshot();
	const secondCommands = [];

	await configureProject({
		rootDir: fixture.rootDir,
		variant: "free",
		commandRunner: fixture.commandRunner(secondCommands),
	});

	assert.deepEqual(fixture.snapshot(), converged);
	assert.deepEqual(secondCommands, [
		["cordova", "plugin", "remove", ADMOB_PLUGIN_ID, "--nosave"],
		["cordova", "plugin", "add", "src/plugins/admob", "--nosave"],
	]);
	assert.equal(
		fs.existsSync(path.join(fixture.rootDir, "plugins", ADMOB_PLUGIN_ID)),
		true,
	);
});

test("fails when a successful command leaves dependency state behind", async (t) => {
	const fixture = createFixture({
		id: ID_PAID,
		dependencyPlugins: [ADMOB_PLUGIN_ID],
	});
	t.after(fixture.remove);

	await assert.rejects(
		configureProject({
			rootDir: fixture.rootDir,
			variant: "paid",
			commandRunner: async () => {},
		}),
		/AdMob must not remain persisted/,
	);
});

test("free builds fail clearly when the committed runtime bundle is missing", () => {
	assert.throws(
		() =>
			getAdmobSyncPlan({
				variant: "free",
				bundleExists: false,
			}),
		/Run `npm run build:admob`/,
	);
});
