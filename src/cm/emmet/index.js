import { Compartment } from "@codemirror/state";
import whenAppVisible from "utils/whenAppVisible";

/**
 * Emmet's syntaxes (EmmetKnownSyntax), kept here so choosing one does not load
 * the Emmet package.
 */
export const EmmetSyntax = Object.freeze({
	html: "html",
	xml: "xml",
	xsl: "xsl",
	jsx: "jsx",
	tsx: "tsx",
	vue: "vue",
	haml: "haml",
	jade: "jade",
	pug: "pug",
	slim: "slim",
	css: "css",
	scss: "scss",
	less: "less",
	sass: "sass",
	sss: "sss",
	stylus: "stylus",
	postcss: "postcss",
});

/** Holds Emmet's extensions; empty until the Emmet chunk has loaded. */
export const emmetCompartment = new Compartment();

/** @type {typeof import("./extensions") | null} */
let emmet = null;
/** @type {Promise<typeof import("./extensions")> | null} */
let loading = null;

/** The loaded Emmet module, or null while it is not needed or still loading. */
export function getLoadedEmmet() {
	return emmet;
}

/**
 * Loads Emmet once the editor is visible; repeated calls share one load.
 * @returns {Promise<typeof import("./extensions")>}
 */
export function loadEmmet() {
	loading ??= whenAppVisible()
		.then(() => import(/* webpackChunkName: "emmet" */ "./extensions"))
		.then(
			(module) => {
				emmet = module;
				return module;
			},
			(error) => {
				loading = null;
				console.error("Failed to load Emmet", error);
				throw error;
			},
		);
	return loading;
}
