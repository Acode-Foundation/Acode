const { rspack } = require("@rspack/core");

const LINE_COMMENT = /\/\/[#@][ \t]*sourceMappingURL=[^\n\r]*/g;
const BLOCK_COMMENT = /\/\*[#@][ \t]*sourceMappingURL=[\s\S]*?\*\//g;

/**
 * Removes stale sourceMappingURL comments left in bundled dependencies.
 *
 * Rspack emits no `.map` files, but some vendored libraries (e.g. TypeScript's
 * worker) keep a `//# sourceMappingURL=` comment in the middle of their source.
 * WebKit honors it, requests the missing map through the app scheme handler, and
 * logs a failed resource load.
 */
class StripSourceMapCommentsPlugin {
	apply(compiler) {
		compiler.hooks.thisCompilation.tap(
			StripSourceMapCommentsPlugin.name,
			(compilation) => {
				compilation.hooks.processAssets.tap(
					{
						name: StripSourceMapCommentsPlugin.name,
						stage: rspack.Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE,
					},
					(assets) => {
						for (const name of Object.keys(assets)) {
							if (!/\.(?:m?js|css)$/.test(name)) continue;
							const asset = compilation.getAsset(name);
							const text = asset.source.source().toString();
							const stripped = text
								.replace(LINE_COMMENT, "")
								.replace(BLOCK_COMMENT, "");
							if (stripped !== text) {
								compilation.updateAsset(
									name,
									new rspack.sources.RawSource(stripped),
								);
							}
						}
					},
				);
			},
		);
	}
}

module.exports = StripSourceMapCommentsPlugin;
