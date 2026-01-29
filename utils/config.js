const path = require("node:path");
const fs = require("node:fs");
const { promisify } = require("node:util");
const exec = promisify(require("node:child_process").exec);

(async () => {
	const AD_APP_ID = "ca-app-pub-5911839694379275~4255791238";
	const CONFIG_ID = /id="([a-z.]+")/;
	const HTML_ID = /<title>[a-z.]+<\/title>/;
	const ID_PAID = "com.foxdebug.acode";
	const ID_FREE = "com.foxdebug.acodefree";
	const arg = process.argv[2];
	const arg2 = process.argv[3];
	const platformsDir = path.resolve(__dirname, "../platforms/");
	const babelrcpath = path.resolve(__dirname, "../.babelrc");
	const configpath = path.resolve(__dirname, "../config.xml");
	const htmlpath = path.resolve(__dirname, "../www/index.html");
	const logopath = path.resolve(
		__dirname,
		"../res/android/values/ic_launcher_background.xml",
	);

	const logoTextPaid = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#3a3e54</color>
    <color name="ic_splash_background">#3a3e54</color>
</resources>`;
	const logoTextFree = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#ffffff</color>
    <color name="ic_splash_background">#313131</color>
</resources>`;

	try {
		let babelrcText = fs.readFileSync(babelrcpath, "utf-8");
		let config = fs.readFileSync(configpath, "utf-8");
		let html = fs.readFileSync(htmlpath, "utf-8");
		let platforms = fs
			.readdirSync(platformsDir)
			.filter((file) => !file.startsWith("."));
		let logo, id, currentId;

		currentId = /id="([a-z.]+)"/.exec(config)[1];
		babelrc = JSON.parse(babelrcText);

		if (arg === "d") {
			babelrc.compact = false;
		} else if (arg === "p") {
			babelrc.compact = true;
		}

		if (arg2 === "free") {
			logo = logoTextFree;
			id = ID_FREE;
		} else {
			logo = logoTextPaid;
			id = ID_PAID;
		}

		fs.writeFileSync(babelrcpath, babelrcText, "utf8");

		if (currentId !== id) {
			const promises = [];

			html = html.replace(HTML_ID, `<title>${id}</title>`);
			config = config.replace(CONFIG_ID, `id="${id}"`);
			babelrcText = JSON.stringify(babelrc, undefined, 2);

			fs.writeFileSync(htmlpath, html, "utf8");
			fs.writeFileSync(logopath, logo, "utf8");
			fs.writeFileSync(configpath, config, "utf8");

			for (let platform of platforms) {
				if (!platform) continue;

				promises.push(
					(async () => {
						console.log(
							`|--- Preparing platform ${platform.toUpperCase()} ---|`,
						);

						if (id === ID_FREE) {
							console.log(`|--- Installing Admob ---|`);
							await exec(
								`cordova plugin add cordova-plugin-consent@2.4.0 --save`,
							);
							await exec(
								`cordova plugin add admob-plus-cordova@2.0.0-alpha.19 --save --variable APP_ID_ANDROID="${AD_APP_ID}" --variable PLAY_SERVICES_VERSION="23.2.0"`,
							);
							console.log("DONE! Installing admob-plus-cordova");
						} else {
							console.log(`|--- Removing Admob ---|`);
							await exec(`cordova plugin remove cordova-plugin-consent --save`);
							await exec(`cordova plugin remove admob-plus-cordova --save`);
							console.log("DONE! Removing admob-plus-cordova");
						}

						console.log(`|--- Reinstalling platform ---|`);
						const { stderr } = await exec(`npm run clean`);
						if (stderr) console.error(stderr);
						else console.log("DONE! Reinstalling platform");
					})(),
				);
			}

			await Promise.all(promises);
		}
		process.exit(0);
	} catch (error) {
		console.error(error);
		process.exit(1);
	}
})();
