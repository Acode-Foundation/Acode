const path = require("node:path");
const fs = require("node:fs");
const yargs = require("yargs");
const { hideBin } = require("yargs/helpers");
const readline = require("node:readline");

const args = yargs(hideBin(process.argv))
	.alias("a", "all")
	.alias("b", "bulk").argv;
const dir = path.resolve(__dirname, "../src/lang");
const read = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
});
const enLang = path.join(dir, "en-us.json");
const list = fs.readdirSync(dir);
const len = list.length;
let command = "";
let arg = "";
let val = "";

if (args._.length > 3) {
	console.error("Invalid arguments", args._);
	process.exit(0);
} else {
	command = args._[0];
	arg = args._[1];
	val = args._[2];
}

switch (command) {
	case "add":
	case "remove":
	case "update":
	case "update-key":
	case "search":
	case "check":
		update();
		break;
	case "add-all":
		addToAllFiles();
		break;
	case "bulk-add":
		bulkAddStrings();
		break;
	default:
		console.error(`Missing/Invalid arguments.
use 'add' to add a new string
use 'add-all <key> <value>' to add the same string to ALL language files at once
use 'bulk-add <json-file>' to add multiple strings from a JSON file to all language files
use 'remove' to remove a string
use 'search' to search a string
use 'update' to update a string
use 'update-key' to update a key
use 'check' to check a string`);
		process.exit();
}

/**
 * Adds a key-value pair to ALL language files at once
 * Usage: pnpm lang add-all "key" "value"
 */
function addToAllFiles() {
	if (!arg || !val) {
		console.error('Usage: pnpm lang add-all "<key>" "<value>"');
		console.error('Example: pnpm lang add-all "hello world" "Hello World"');
		process.exit(1);
	}

	const key = arg.toLowerCase();
	let addedCount = 0;
	let skippedCount = 0;

	for (const lang of list) {
		const file = path.resolve(dir, lang);
		const text = fs.readFileSync(file, "utf8");
		const strings = JSON.parse(text);

		if (key in strings) {
			console.log(`${lang}: Skipped (already exists)`);
			skippedCount++;
			continue;
		}

		strings[key] = val;
		const newText = JSON.stringify(strings, undefined, 2);
		fs.writeFileSync(file, newText, "utf8");
		console.log(`${lang}: Added ✓`);
		addedCount++;
	}

	console.log(
		`\nDone! Added to ${addedCount} files, skipped ${skippedCount} files.`,
	);
	process.exit(0);
}

/**
 * Bulk add multiple strings from a JSON file to ALL language files
 * Usage: pnpm lang bulk-add strings.json
 *
 * JSON file format:
 * {
 *   "key1": "value1",
 *   "key2": "value2"
 * }
 */
function bulkAddStrings() {
	if (!arg) {
		console.error("Usage: pnpm lang bulk-add <json-file>");
		console.error("Example: pnpm lang bulk-add new-strings.json");
		console.error("\nJSON file format:");
		console.error("{");
		console.error('  "key1": "value1",');
		console.error('  "key2": "value2"');
		console.error("}");
		process.exit(1);
	}

	const jsonFilePath = path.resolve(process.cwd(), arg);

	if (!fs.existsSync(jsonFilePath)) {
		console.error(`File not found: ${jsonFilePath}`);
		process.exit(1);
	}

	let newStrings;
	try {
		const jsonContent = fs.readFileSync(jsonFilePath, "utf8");
		newStrings = JSON.parse(jsonContent);
	} catch (err) {
		console.error(`Error parsing JSON file: ${err.message}`);
		process.exit(1);
	}

	const keys = Object.keys(newStrings);
	if (keys.length === 0) {
		console.error("No strings found in the JSON file.");
		process.exit(1);
	}

	console.log(
		`Adding ${keys.length} strings to ${list.length} language files...\n`,
	);

	for (const lang of list) {
		const file = path.resolve(dir, lang);
		const text = fs.readFileSync(file, "utf8");
		const strings = JSON.parse(text);
		let addedCount = 0;
		let skippedCount = 0;

		for (const key of keys) {
			const lowerKey = key.toLowerCase();
			if (lowerKey in strings) {
				skippedCount++;
				continue;
			}
			strings[lowerKey] = newStrings[key];
			addedCount++;
		}

		if (addedCount > 0) {
			const newText = JSON.stringify(strings, undefined, 2);
			fs.writeFileSync(file, newText, "utf8");
		}

		console.log(`${lang}: Added ${addedCount}, Skipped ${skippedCount}`);
	}

	console.log(`\nDone! Added ${keys.length} strings to all language files.`);
	process.exit(0);
}

async function update() {
	let key;

	if (command === "check") {
		let error = false;
		const fix = arg === "fix";
		const enLangData = JSON.parse(fs.readFileSync(enLang, "utf8"));
		const enKeys = Object.keys(enLangData);

		for (const file of list) {
			if (file === "en-us.json") continue;

			let flagError = false;
			const langFile = path.join(dir, file);
			const langData = JSON.parse(fs.readFileSync(langFile, "utf8"));

			const langError = () => {
				if (!flagError) {
					error = true;
					flagError = true;
					console.log(`-------------- ${file}`);
				}
			};

			for (const enKey of enKeys) {
				const key = Object.keys(langData).find((k) => {
					try {
						return new RegExp(`^${escapeRegExp(k)}$`, "i").test(enKey);
					} catch (e) {
						console.log({ e, k });
						return false;
					}
				});

				if (!key) {
					langError();
					if (fix) {
						langData[enKey] = enLangData[enKey];
					}

					console.log(`Missing: ${enKey} ${fix ? "✔" : ""}`);
				} else if (key !== enKey) {
					langError();
					console.log(`Fix: "${key} --> ${enKey}" ${fix ? "✔" : ""}`);

					if (fix) {
						const val = langData[key];
						delete langData[key];
						langData[enKey] = val;
					}
				}
			}

			for (const key in langData) {
				const enKey = enKeys.find((k) => {
					try {
						return new RegExp(`^${escapeRegExp(k)}$`, "i").test(key);
					} catch (e) {
						console.log({ e, k });
						return false;
					}
				});

				if (!enKey) {
					langError();
					if (fix) {
						delete langData[key];
					}

					console.log(`Stale: ${key} ${fix ? "✔" : ""}`);
				}
			}

			if (flagError) {
				if (fix) {
					const langJSONData = JSON.stringify(langData, undefined, 2);
					fs.writeFileSync(langFile, langJSONData);
				}
				console.log("\n");
			}
		}

		if (!error) {
			console.log("\nGOOD NEWS! No Error Found\n");
		}
		process.exit(error && !fix ? 1 : 0);
		return;
	}

	if (!arg) {
		getStr("string: ").then((res) => {
			key = res.toLowerCase();
			arg = res;
			askTranslation();
		});
		return;
	}

	key = arg.toLowerCase();
	let newKey = val;
	askTranslation();

	if (command === "update-key" && !newKey) {
		newKey = await getStr("new key: ");
	}

	function askTranslation(i = 0) {
		const lang = list[i];
		const langName = lang.split(".")[0];
		if (command === "add") {
			if (!args.a) {
				getStr(`${langName}: `).then(addString);
				return;
			}

			addString();
		} else if (command === "remove") {
			update((strings) => {
				if (key in strings) {
					delete strings[key];
					console.log(`Removed: ${key}`);
					return strings;
				} else {
					console.error("String not exists");
				}
			});
		} else if (command === "update-key") {
			update((strings) => {
				const val = strings[key];
				delete strings[key];
				strings[newKey] = val;
				return strings;
			});
		} else if (command === "update") {
			if (val) {
				update((strings) => {
					strings[key] = val;
					return strings;
				});
			} else {
				getStr(`${langName}: `).then((res) => {
					res = res || arg;
					update((strings) => {
						strings[key] = res;
						return strings;
					});
				});
			}
		} else if (command === "search") {
			update((string) => {
				if (key in string) console.log(`${key}(${langName}): ${string[key]}`);
				else {
					console.log(`${key} not exists`);
					process.exit();
				}
			});
		}

		function update(modify) {
			const file = path.resolve(dir, lang);
			const text = fs.readFileSync(file, "utf8");
			const strings = modify(JSON.parse(text));
			if (strings) {
				const newText = JSON.stringify(strings, undefined, 2);
				fs.writeFile(file, newText, "utf8", (err) => {
					if (err) {
						console.error(err);
						process.exit(1);
					}

					next();
				});
			} else {
				next();
			}

			function next() {
				if (i === list.length - 1) {
					process.exit();
				} else {
					askTranslation(++i);
				}
			}
		}

		function addString(string) {
			string = string || arg;
			update((strings) => {
				if (key in strings) {
					console.error("String already exists");
					process.exit(1);
				} else {
					strings[key] = string;
					return strings;
				}
			});
		}
	}
}

function getStr(str) {
	return new Promise((resolve, reject) => {
		if (val) {
			resolve(val);
			return;
		}

		read.question(str, (res) => {
			resolve(res);
		});
	});
}

function escapeRegExp(text) {
	return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
}
