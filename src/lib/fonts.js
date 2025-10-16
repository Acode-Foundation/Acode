import fsOperation from "fileSystem";
import loader from "dialogs/loader";
import helpers from "utils/helpers";
import Url from "utils/Url";
import firaCode from "../res/fonts/FiraCode.ttf";
import MesloLGSNFRegular from "../res/fonts/MesloLGSNFRegular.ttf";
import robotoMono from "../res/fonts/RobotoMono.ttf";

const fonts = new Map();
const customFontNames = new Set();
const CUSTOM_FONTS_KEY = "custom_fonts";
const FONT_FACE_STYLE_ID = "font-face-style";
const EDITOR_STYLE_ID = "editor-font-style";

add(
	"Fira Code",
	`@font-face {
  font-family: 'Fira Code';
  src: url(${firaCode}) format('truetype');
  font-weight: 300 700;
  font-style: normal;
}`,
);

add(
	"Roboto Mono",
	`@font-face {
  font-family: 'Roboto Mono';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(${robotoMono}) format('truetype');
  unicode-range: U+0460-052F, U+1C80-1C88, U+20B4, U+2DE0-2DFF, U+A640-A69F,
    U+FE2E-FE2F;
}`,
);

add(
	"MesloLGS NF Regular",
	`@font-face {
  font-family: 'MesloLGS NF Regular';
  font-style: normal;
  font-weight: normal;
  src: url(${MesloLGSNFRegular}) format('truetype');
}`,
);

add(
	"Source Code",
	`@font-face {
  font-family: 'Source Code';
  src: url(https://acode.app/SourceCodePro.ttf) format('truetype');
  font-weight: 300 700;
  font-style: normal;
}`,
);

add(
	"Victor Mono Italic",
	`@font-face {
  font-family: 'Victor Mono Italic';
  src: url(https://acode.app/VictorMono-Italic.otf) format('truetype');
  font-style: normal;
}`,
);

add(
	"Victor Mono Medium",
	`@font-face {
  font-family: 'Victor Mono Medium';
  src: url(https://acode.app/VictorMono-Medium.otf) format('truetype');
  font-weight: medium;
  font-style: normal;
}`,
);

add(
	"Cascadia Code",
	`@font-face {
  font-family: 'Cascadia Code';
  src: url(https://acode.app/CascadiaCode.ttf) format('truetype');
  font-weight: 300 700;
  font-style: normal;
}`,
);

add(
	"Proggy Clean",
	`@font-face {
  font-family: 'Proggy Clean';
  src: url(https://acode.app/ProggyClean.ttf) format('truetype');
  font-weight: 300 700;
  font-style: normal;
}`,
);

add(
	"JetBrains Mono Bold",
	`@font-face {
  font-family: 'JetBrains Mono Bold';
  src: url(https://acode.app/JetBrainsMono-Bold.ttf) format('truetype');
  font-weight: bold;
}`,
);

add(
	"JetBrains Mono Regular",
	`@font-face {
  font-family: 'JetBrains Mono Regular';
  src: url(https://acode.app/JetBrainsMono-Regular.ttf) format('truetype');
  font-weight: 300 700;
  font-style: normal;
}`,
);

add(
	"Noto Mono",
	`@font-face {
  font-display: swap;
  font-family: 'Noto Mono';
  src: url(https://acode.app/NotoMono-Regular.woff) format("woff");
  font-weight: 400;
  font-style: normal;
  unicode-range: U+0590-06FF;
}`,
);

// Load custom fonts on module initialization
loadCustomFonts();

function add(name, css) {
	fonts.set(name, css);
}

function addCustom(name, css) {
	fonts.set(name, css);
	customFontNames.add(name);
	saveCustomFonts();
}

function saveCustomFonts() {
	const customFonts = {};

	for (const name of customFontNames) {
		const css = fonts.get(name);
		if (css) {
			customFonts[name] = css;
		}
	}

	localStorage.setItem(CUSTOM_FONTS_KEY, JSON.stringify(customFonts));
}

function loadCustomFonts() {
	try {
		const customFonts = localStorage.getItem(CUSTOM_FONTS_KEY);
		if (customFonts) {
			const parsed = JSON.parse(customFonts);
			for (const [name, css] of Object.entries(parsed)) {
				fonts.set(name, css);
				customFontNames.add(name);
			}
		}
	} catch (error) {
		console.error("Failed to load custom fonts:", error);
	}
}

function get(name) {
	return fonts.get(name);
}

function getNames() {
	return [...fonts.keys()];
}

function remove(name) {
	const result = fonts.delete(name);
	if (result) {
		customFontNames.delete(name);
		saveCustomFonts();
	}
	return result;
}

function has(name) {
	return fonts.has(name);
}

async function setFont(name) {
	loader.showTitleLoader();
	try {
		await loadFont(name);
		const $style = ensureStyleElement(EDITOR_STYLE_ID);
		$style.textContent = `.editor-container.ace_editor{
    font-family: "${name}", NotoMono, Monaco, MONOSPACE !important;
  }
  .ace_text{
    font-family: inherit !important;
  }`;
	} catch (error) {
		toast(`${name} font not found`, "error");
		setFont("Roboto Mono");
	} finally {
		loader.removeTitleLoader();
	}
}

async function downloadFont(name, link) {
	const FONT_DIR = Url.join(DATA_STORAGE, "fonts");
	const FONT_FILE = Url.join(FONT_DIR, name);

	const fs = fsOperation(FONT_FILE);
	if (await fs.exists()) return FONT_FILE;

	if (!(await fsOperation(FONT_DIR).exists())) {
		await fsOperation(DATA_STORAGE).createDirectory("fonts");
	}

	const font = await fsOperation(link).readFile();
	console.log("fonts content : ", font);
	await fsOperation(FONT_DIR).createFile(name, font);

	return FONT_FILE;
}

async function loadFont(name) {
	const $style = ensureStyleElement(FONT_FACE_STYLE_ID);
	let css = get(name);

	if (!css) {
		throw new Error(`Font ${name} not found`);
	}

	// Get all URL font references
	const urls = [...css.matchAll(/url\((.*?)\)/g)].map((match) => match[1]);

	// Download and replace URLs
	for (const url of urls) {
		if (!/^https?/.test(url)) continue;
		if (/^https?:\/\/localhost/.test(url)) continue;
		const fontFile = await downloadFont(name, url);
		const internalUrl = await helpers.toInternalUri(fontFile);
		css = css.replace(url, internalUrl);
	}

	// Add font face to document if not already present
	if (!$style.textContent.includes(`font-family: '${name}'`)) {
		$style.textContent = `${$style.textContent}\n${css}`;
	}

	return css;
}

function ensureStyleElement(id) {
	const selector = `style#${id}`;
	const $style = tag.get(selector) ?? <style id={id}></style>;
	if (!$style.isConnected) {
		document.head.append($style);
	}
	return $style;
}

export default {
	add,
	addCustom,
	get,
	getNames,
	remove,
	has,
	setFont,
	loadFont,
};
