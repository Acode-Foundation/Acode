const PRETTIER_ID = "prettier";
const PRETTIER_NAME = "Prettier";

const SUPPORTED_EXTENSIONS = [
	"js",
	"cjs",
	"mjs",
	"jsx",
	"ts",
	"tsx",
	"json",
	"json5",
	"css",
	"scss",
	"less",
	"html",
	"htm",
	"vue",
	"md",
	"markdown",
	"mdx",
	"yaml",
	"yml",
	"graphql",
	"gql",
];

export function registerPrettierFormatter() {
	if (!window?.acode) return;
	const alreadyRegistered = acode.formatters.some(
		({ id }) => id === PRETTIER_ID,
	);
	if (alreadyRegistered) return;

	acode.registerFormatter(
		PRETTIER_ID,
		SUPPORTED_EXTENSIONS,
		async () => {
			const { formatActiveFileWithPrettier } = await import(
				/* webpackChunkName: "prettierFormatter" */ "lib/prettierFormatter"
			);
			return formatActiveFileWithPrettier();
		},
		PRETTIER_NAME,
	);
}
