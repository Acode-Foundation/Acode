import { languages } from "@codemirror/language-data";
import type { Extension } from "@codemirror/state";
import { addMode } from "./modelist";

type FilenameMatcher = string | RegExp;

interface LanguageDescription {
	name?: string;
	alias?: readonly string[];
	extensions?: readonly string[];
	filenames?: readonly FilenameMatcher[];
	filename?: FilenameMatcher;
	load?: () => Promise<Extension>;
}

function normalizeModeKey(value: string): string {
	return String(value ?? "")
		.trim()
		.toLowerCase();
}

function isSafeModeId(value: string): boolean {
	return /^[a-z0-9][a-z0-9._-]*$/.test(value);
}

function slugifyModeId(value: string): string {
	return normalizeModeKey(value)
		.replace(/\+\+/g, "pp")
		.replace(/#/g, "sharp")
		.replace(/&/g, "and")
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

function collectAliases(
	name: string,
	aliases: readonly string[] | undefined,
): string[] {
	return [
		...new Set(
			[name, ...(aliases || [])].map(normalizeModeKey).filter(Boolean),
		),
	];
}

function getModeId(name: string, aliases: string[]): string {
	const normalizedName = normalizeModeKey(name);
	if (isSafeModeId(normalizedName)) return normalizedName;

	const safeAlias = aliases.find(
		(alias) => alias !== normalizedName && isSafeModeId(alias),
	);
	return safeAlias || slugifyModeId(name) || normalizedName || "text";
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function shouldAutoCloseTags(): Promise<boolean> {
	const { default: appSettings } = await import("lib/settings");
	return appSettings.value.autoCloseTags !== false;
}

function createLanguageLoader(name: string, lang: LanguageDescription) {
	const normalizedName = normalizeModeKey(name);

	switch (normalizedName) {
		case "javascript":
			return async () => {
				const { javascript } = await import("@codemirror/lang-javascript");
				return javascript({ jsx: true });
			};

		case "html":
			return async () => {
				const { html } = await import("@codemirror/lang-html");
				return html({ autoCloseTags: await shouldAutoCloseTags() });
			};

		case "xml":
			return async () => {
				const { xml } = await import("@codemirror/lang-xml");
				return xml({ autoCloseTags: await shouldAutoCloseTags() });
			};

		case "vue":
			return async () => {
				const [{ vue }, { html }] = await Promise.all([
					import("@codemirror/lang-vue"),
					import("@codemirror/lang-html"),
				]);
				return vue({
					base: html({ autoCloseTags: await shouldAutoCloseTags() }),
				});
			};

		case "angular":
			return async () => {
				const [{ angular }, { html }] = await Promise.all([
					import("@codemirror/lang-angular"),
					import("@codemirror/lang-html"),
				]);
				return angular({
					base: html({
						autoCloseTags: await shouldAutoCloseTags(),
						selfClosingTags: true,
					}),
				});
			};

		case "php":
			return async () => {
				const [{ php }, { html }] = await Promise.all([
					import("@codemirror/lang-php"),
					import("@codemirror/lang-html"),
				]);
				const htmlSupport = html({
					autoCloseTags: await shouldAutoCloseTags(),
					matchClosingTags: false,
				});
				return [
					php({ baseLanguage: htmlSupport.language }),
					htmlSupport.support,
				];
			};
	}

	return typeof lang.load === "function" ? () => lang.load!() : null;
}

// 1) Always register a plain text fallback
addMode("Text", "txt|text|log|plain|lock|pub|gitkeep|keep|mk|^makefile", "Plain Text", () => []);

// 2) Register all languages provided by @codemirror/language-data
//    We convert extensions like [".js", ".mjs"] into a modelist pattern: "js|mjs"
//    and preserve aliases and filename regexes for languages like C++ and Dockerfile.
for (const lang of languages as readonly LanguageDescription[]) {
	try {
		const name = String(lang?.name || "").trim();
		if (!name) continue;

		const aliases = collectAliases(name, lang.alias);
		const modeId = getModeId(name, aliases);

		// File extensions & filenames
		const langExtensions = [...(lang.extensions || [])];
		const filenames = [
			...(Array.isArray(lang.filenames)
				? lang.filenames
				: lang.filename
					? [lang.filename]
					: []),
		];

		// Merge custom mappings to make language detection robust
		const normalizedName = name.toLowerCase();
		if (normalizedName === "shell" || modeId === "shell") {
			langExtensions.push(
				"zsh",
				"zshrc",
				"bashrc",
				"bash_profile",
				"zprofile",
				"zlogin",
				"zlogout",
				"zshenv",
				"profile",
				"bash_login",
				"bash_logout",
				"zunit",
				"ztst",
				"zsh-theme",
				"bash_history",
				"zsh_history",
			);
			filenames.push(
				".bashrc",
				".zshrc",
				".bash_profile",
				".zprofile",
				".zlogin",
				".zlogout",
				".zshenv",
				".profile",
				".bash_login",
				".bash_logout",
				".bash_history",
				".zsh_history",
			);
		} else if (
			normalizedName === "properties files" ||
			normalizedName === "properties" ||
			modeId === "ini"
		) {
			langExtensions.push(
				"gitconfig",
				"gitmodules",
				"editorconfig",
				"npmrc",
				"yarnrc",
			);
			filenames.push(
				".gitconfig",
				".gitmodules",
				".editorconfig",
				".npmrc",
				".yarnrc",
			);
		} else if (normalizedName === "json" || modeId === "json") {
			langExtensions.push("prettierrc", "hintrc", "eslintrc", "babelrc");
			filenames.push(".prettierrc", ".hintrc", ".eslintrc", ".babelrc", "bun.lock");
		} else if (normalizedName === "yaml" || modeId === "yaml") {
			filenames.push("yarn.lock");
		} else if (normalizedName === "toml" || modeId === "toml") {
			filenames.push("Cargo.lock", "poetry.lock");
		} else if (normalizedName === "protobuf" || modeId === "protobuf") {
			langExtensions.push("pb");
		}

		const parts: string[] = [];
		for (const e of langExtensions) {
			if (typeof e !== "string") continue;
			const cleaned = e.replace(/^\./, "").trim();
			if (cleaned) parts.push(cleaned);
		}

		const filenameMatchers: RegExp[] = [];
		for (const fn of filenames) {
			if (typeof fn === "string") {
				const cleaned = fn.trim();
				if (cleaned) {
					filenameMatchers.push(new RegExp(`^${escapeRegExp(cleaned)}$`, "i"));
				}
				continue;
			}

			if (fn instanceof RegExp) {
				filenameMatchers.push(new RegExp(fn.source, fn.flags));
			}
		}

		const pattern = parts.join("|");

		// Wrap language-data loader as our modelist language provider
		// lang.load() returns a Promise<Extension>; we let the editor handle async loading
		const loader = createLanguageLoader(name, lang);

		addMode(modeId, pattern, name, loader, {
			aliases,
			filenameMatchers,
		});
	} catch (_) {
		// Ignore faulty entries to avoid breaking the whole registration
	}
}

// Luau isn't bundled in @codemirror/language-data, so register it explicitly.
addMode("Luau", "luau", "Luau", async () => {
	const { luau } = await import("./modes/luau");
	return luau();
});

// Astro isn't bundled in @codemirror/language-data. Register it with HTML as
// the structural parser plus Astro frontmatter and expression highlighting.
addMode("Astro", "astro", "Astro", async () => {
	const { astro } = await import("./modes/astro");
	return astro({ autoCloseTags: await shouldAutoCloseTags() });
});
