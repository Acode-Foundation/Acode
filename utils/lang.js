const path = require("node:path");
const fs = require("node:fs");
const yargs = require("yargs");
const { hideBin } = require("yargs/helpers");
const readline = require("node:readline");

const args = yargs(hideBin(process.argv)).alias("a", "all").argv;
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
	default:
		console.error(`Missing/Invalid arguments.
use 'add' to add a new string
use 'remove' to remove a string
use 'search' to search a string
use 'update' to update a string
use 'update-key' to update a key
use 'check' to check a string`);
		process.exit();
}

async function update() {
	let key;

	if (command === "check") {
		let total = 0;
		let done = 0;

		fs.readFile(enLang, "utf-8", (err, data) => {
			if (err) {
				console.error(err);
				process.exit(0);
				return;
			}

			let error = false;

			const fix = arg === "fix";
			const enLangData = JSON.parse(data);

			list.forEach((file, i) => {
				if (file === "en-us.json") return;

				let flagError = false;
				let langFile = path.join(dir, file);
				const exit = (i, len) => {
					if (i + 1 === len) {
						if (!error) {
							console.log("\nGOOD NEWS! No Error Found\n");
						}
						process.exit(0);
					}
				};

				fs.readFile(langFile, "utf-8", (err, data) => {
					if (err) {
						console.error(err);
						process.exit(1);
						return;
					}

					let langError = () => {
						if (!flagError) {
							error = true;
							flagError = true;
							console.log(`-------------- ${file}`);
						}
					};
					const langData = JSON.parse(data);
					flagError = false;

					for (let enKey in enLangData) {
						const key = Object.keys(langData).find((k) => {
							try {
								if (new RegExp(`^${escapeRegExp(k)}$`, "i").test(enKey)) {
									return true;
								}
								return false;
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

					if (flagError) {
						if (fix) {
							total += 1;
							const langJSONData = JSON.stringify(langData, undefined, 2);
							fs.writeFile(langFile, langJSONData, (err) => {
								if (err) {
									console.error(err);
									process.exit(1);
								}
								done += 1;
								exit(done, total);
							});
						}
						console.log("\n");
					}

					if (!fix) {
						exit(i, len);
					}
				});
			});
		});
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
