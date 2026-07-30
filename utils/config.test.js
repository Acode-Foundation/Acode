const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
	ADMOB_PLUGIN_ID,
	ID_FREE,
	ID_PAID,
	configureProject,
	getAdmobSyncPlan,
} = require("./config");

function createFixture({ id, pluginInstalled = false, bundleExists = true }) {
	const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "acode-config-"));
	const write = (relativePath, contents = "") => {
		const filePath = path.join(rootDir, relativePath);
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, contents);
	};

	write("config.xml", `<widget id="${id}" version="1.0.0"></widget>\n`);
	write(".babelrc", '{"compact":false}\n');
	write(
		"res/android/values/ic_launcher_background.xml",
		"<resources></resources>\n",
	);
	if (bundleExists) write("src/plugins/admob/www/admob.js", "bundle");
	if (pluginInstalled) write(`plugins/${ADMOB_PLUGIN_ID}/plugin.xml`, "plugin");

	return {
		rootDir,
		remove() {
			fs.rmSync(rootDir, { recursive: true });
		},
	};
}

test("free builds reinstall AdMob even when the widget id already matches", async (t) => {
	const fixture = createFixture({
		id: ID_FREE,
		pluginInstalled: true,
	});
	t.after(fixture.remove);
	const commands = [];

	const result = await configureProject({
		rootDir: fixture.rootDir,
		variant: "free",
		commandRunner: async (command, args) => commands.push([command, ...args]),
	});

	assert.equal(result.identityChanged, false);
	assert.deepEqual(commands, [
		["cordova", "plugin", "remove", ADMOB_PLUGIN_ID, "--nosave"],
		["cordova", "plugin", "add", "src/plugins/admob", "--nosave"],
	]);
});

test("paid builds remain idempotent when AdMob is already absent", async (t) => {
	const fixture = createFixture({ id: ID_PAID });
	t.after(fixture.remove);
	const commands = [];

	const result = await configureProject({
		rootDir: fixture.rootDir,
		variant: "paid",
		commandRunner: async (command, args) => commands.push([command, ...args]),
	});

	assert.equal(result.identityChanged, false);
	assert.deepEqual(commands, []);
});

test("switching from free to paid removes AdMob and refreshes platforms", async (t) => {
	const fixture = createFixture({
		id: ID_FREE,
		pluginInstalled: true,
	});
	t.after(fixture.remove);
	fs.mkdirSync(path.join(fixture.rootDir, "platforms/android"), {
		recursive: true,
	});
	const commands = [];

	const result = await configureProject({
		rootDir: fixture.rootDir,
		variant: "paid",
		commandRunner: async (command, args) => commands.push([command, ...args]),
	});

	assert.equal(result.identityChanged, true);
	assert.match(
		fs.readFileSync(path.join(fixture.rootDir, "config.xml"), "utf8"),
		new RegExp(`id="${ID_PAID}"`),
	);
	assert.deepEqual(commands, [
		["cordova", "plugin", "remove", ADMOB_PLUGIN_ID, "--nosave"],
		["npm", "run", "clean"],
	]);
});

test("free builds fail clearly when the committed runtime bundle is missing", () => {
	assert.throws(
		() =>
			getAdmobSyncPlan({
				variant: "free",
				bundleExists: false,
				pluginInstalled: false,
			}),
		/Run `npm run build:admob`/,
	);
});
