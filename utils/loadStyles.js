const fs = require("node:fs");
const path = require("node:path");

const WWW = path.resolve(__dirname, "../www");
const CSS = path.resolve(WWW, "css/build");
const CSS_PATH = "./css/build/";

const cssFiles = fs.readdirSync(CSS).filter((file) => file.endsWith(".css"));
const htmlFiles = fs.readdirSync(WWW).filter((file) => file.endsWith(".html"));

try {
	for (const htmlFile of htmlFiles) {
		loadStyles(path.resolve(WWW, htmlFile));
	}
} catch (error) {
	console.error(error);
	process.exit(1);
}

console.log("Styles loaded");
process.exit(0);

/**
 *
 * @param {String} htmlFile
 */
function loadStyles(htmlFile) {
	let styles = "<!--styles-->";

	for (const cssFile of cssFiles) {
		styles += `\n<link rel="stylesheet" href="${CSS_PATH}${cssFile}">`;
	}

	styles += "\n<!--styles_end-->\n";

	const rgx =
		/<!--styles-->([^<]*(?:<(?!!--styles_end-->)[^<]*)*)<!--styles_end-->\n*/gim;
	let html = fs.readFileSync(htmlFile, "utf8");
	html = html.replace(rgx, "");
	html = html.replace("</head>", styles + "</head>");
	fs.writeFileSync(htmlFile, html);
}
