import loader from "dialogs/loader";
import fsOperation from "fileSystem";
import Url from "utils/Url";
import helpers from "utils/helpers";

const fonts = new Map();

add(
	"Fira Code",
	`@font-face {
  font-family: 'Fira Code';
  src: url(../res/fonts/FiraCode.ttf) format('truetype');
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
  src: url(../res/fonts/RobotoMono.ttf) format('truetype');
  unicode-range: U+0460-052F, U+1C80-1C88, U+20B4, U+2DE0-2DFF, U+A640-A69F,
    U+FE2E-FE2F;
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

function add(name, css) {
	fonts.set(name, css);
}

function get(name) {
	return fonts.get(name);
}

function getNames() {
	return [...fonts.keys()];
}

async function setFont(name) {
	loader.showTitleLoader();
	try {
		const $style = tag.get("style#font-style") ?? (
			<style id="font-style"></style>
		);
		let css = get(name);

		// Get all URL font references
		const urls = [...css.matchAll(/url\((.*?)\)/g)].map((match) => match[1]);

		urls?.map(async (url) => {
			if (!/^https?/.test(url)) return;
			if (/^https?:\/\/localhost/.test(url)) return;
			const fontFile = await downloadFont(name, url);
			const internalUrl = await helpers.toInternalUri(fontFile);
			css = css.replace(url, internalUrl);
		}),
			($style.textContent = `${css}
  .editor-container.ace_editor{
    font-family: "${name}", NotoMono, Monaco, MONOSPACE !important;
  }
  .ace_text{
    font-family: inherit !important;
  }`);
		document.head.append($style);
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

export default {
	add,
	get,
	getNames,
	setFont,
};
