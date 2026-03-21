import fsOperation from "fileSystem";
import { parse } from "acorn";
import toast from "components/toast";
import appSettings from "lib/settings";
import prettierPluginBabel from "prettier/plugins/babel";
import prettierPluginEstree from "prettier/plugins/estree";
import prettierPluginGraphql from "prettier/plugins/graphql";
import prettierPluginHtml from "prettier/plugins/html";
import prettierPluginMarkdown from "prettier/plugins/markdown";
import prettierPluginPostcss from "prettier/plugins/postcss";
import prettierPluginTypescript from "prettier/plugins/typescript";
import prettierPluginYaml from "prettier/plugins/yaml";
import prettier from "prettier/standalone";
import helpers from "utils/helpers";
import Url from "utils/Url";

const PRETTIER_ID = "prettier";
const PRETTIER_NAME = "Prettier";
const CONFIG_FILENAMES = [
	".prettierrc",
	".prettierrc.json",
	".prettierrc.json5",
	".prettierrc.js",
	".prettierrc.cjs",
	".prettierrc.mjs",
	".prettierrc.config.cjs",
	".prettierrc.config.mjs",
	".prettier.config.js",
	".prettier.config.cjs",
	".prettier.config.mjs",
	"prettier.config.json",
	"prettier.config.js",
	"prettier.config.cjs",
	"prettier.config.mjs",
];
const PRETTIER_PLUGINS = [
	prettierPluginEstree,
	prettierPluginBabel,
	prettierPluginHtml,
	prettierPluginMarkdown,
	prettierPluginPostcss,
	prettierPluginTypescript,
	prettierPluginYaml,
	prettierPluginGraphql,
];

/**
 * Supported parser mapping keyed by CodeMirror mode name
 * @type {Record<string, string>}
 */
const MODE_TO_PARSER = {
	angular: "angular",
	gfm: "markdown",
	css: "css",
	graphql: "graphql",
	html: "html",
	json: "json",
	json5: "json",
	jsx: "babel",
	less: "less",
	markdown: "markdown",
	md: "markdown",
	mdx: "mdx",
	scss: "scss",
	styled_jsx: "babel",
	typescript: "typescript",
	tsx: "typescript",
	jsonc: "json",
	yaml: "yaml",
	yml: "yaml",
	vue: "vue",
	javascript: "babel",
};

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

/**
 * Register Prettier formatter with Acode instance
 */
export function registerPrettierFormatter() {
	if (!window?.acode) return;
	const alreadyRegistered = acode.formatters.some(
		({ id }) => id === PRETTIER_ID,
	);
	if (alreadyRegistered) return;
	acode.registerFormatter(
		PRETTIER_ID,
		SUPPORTED_EXTENSIONS,
		() => formatActiveFileWithPrettier(),
		PRETTIER_NAME,
	);
}

async function formatActiveFileWithPrettier() {
	const file = editorManager?.activeFile;
	const editor = editorManager?.editor;
	if (!file || file.type !== "editor" || !editor) return false;

	const modeName = (file.currentMode || "text").toLowerCase();
	const parser = getParserForMode(modeName);
	if (!parser) {
		toast("Prettier does not support this file type yet");
		return false;
	}

	const doc = editor.state.doc;
	const source = doc.toString();
	const filepath = file.uri || file.filename || "";
	try {
		const config = await resolvePrettierConfig(file);
		const formatted = await prettier.format(source, {
			...config,
			parser,
			plugins: PRETTIER_PLUGINS,
			filepath,
			overrideEditorconfig: true,
		});

		if (formatted === source) return true;

		editor.dispatch({
			changes: {
				from: 0,
				to: doc.length,
				insert: formatted,
			},
		});
		return true;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		toast(message);
		return false;
	}
}

function getParserForMode(modeName) {
	if (MODE_TO_PARSER[modeName]) return MODE_TO_PARSER[modeName];
	if (modeName.includes("javascript")) return "babel";
	if (modeName.includes("typescript")) return "typescript";
	return null;
}

async function resolvePrettierConfig(file) {
	const overrides = appSettings?.value?.prettier || {};
	const projectConfig = await loadProjectConfig(file);
	const result = { ...overrides, ...(projectConfig || {}) };
	if (file?.eol && result.endOfLine == null) {
		result.endOfLine = file.eol === "windows" ? "crlf" : "lf";
	}
	if (result.useTabs == null) {
		result.useTabs = !appSettings?.value?.softTab;
	}
	if (
		result.tabWidth == null &&
		typeof appSettings?.value?.tabSize === "number"
	) {
		result.tabWidth = appSettings.value.tabSize;
	}
	return result;
}

async function loadProjectConfig(file) {
	const uri = file?.uri;
	if (!uri) return null;

	const projectRoot = findProjectRoot(uri);
	const directories = collectCandidateDirectories(uri, projectRoot);

	for (const directory of directories) {
		const config = await readConfigFromDirectory(directory);
		if (config) return config;
	}

	return null;
}

function findProjectRoot(uri) {
	const folders = Array.isArray(globalThis.addedFolder)
		? globalThis.addedFolder
		: [];
	const target = normalizePath(uri);
	let match = null;
	let matchLength = -1;

	for (const folder of folders) {
		const folderUrl = folder?.url;
		if (!folderUrl) continue;
		const normalized = normalizePath(folderUrl);
		if (!normalized) continue;
		if (target === normalized || target.startsWith(`${normalized}/`)) {
			if (normalized.length > matchLength) {
				match = folderUrl;
				matchLength = normalized.length;
			}
		}
	}

	return match;
}

function collectCandidateDirectories(fileUri, projectRoot) {
	const directories = [];
	const visited = new Set();
	let currentDir = safeDirname(fileUri);

	while (currentDir) {
		const normalized = normalizePath(currentDir);
		if (visited.has(normalized)) break;
		directories.push(currentDir);
		visited.add(normalized);
		if (projectRoot && pathsAreSame(currentDir, projectRoot)) break;
		const parent = safeDirname(currentDir);
		if (!parent || parent === currentDir) break;
		currentDir = parent;
	}

	if (
		projectRoot &&
		!directories.some((dir) => pathsAreSame(dir, projectRoot))
	) {
		directories.push(projectRoot);
	}

	return directories;
}

function safeDirname(path) {
	try {
		return Url.dirname(path);
	} catch (_) {
		return null;
	}
}

async function readConfigFromDirectory(directory) {
	if (!directory) return null;

	for (const name of CONFIG_FILENAMES) {
		const config = await loadConfigFile(directory, name);
		if (config) return config;
	}

	return loadPrettierFromPackageJson(directory);
}

async function loadConfigFile(directory, basename) {
	try {
		const filePath = Url.join(directory, basename);
		const fs = fsOperation(filePath);
		if (!(await fs.exists())) return null;
		const text = await fs.readFile("utf8");

		switch (basename) {
			case ".prettierrc":
			case ".prettierrc.json":
			case ".prettierrc.json5":
			case "prettier.config.json":
				return parseJsonLike(text);
			case ".prettierrc.js":
			case ".prettier.config.js":
			case "prettier.config.js":
				return parseJsConfig(directory, text, filePath);
			case ".prettierrc.mjs":
			case ".prettierrc.config.mjs":
			case ".prettier.config.mjs":
			case "prettier.config.mjs":
				return parseJsConfig(directory, text, filePath);
			case ".prettierrc.cjs":
			case ".prettierrc.config.cjs":
			case ".prettier.config.cjs":
			case "prettier.config.cjs":
				return parseJsConfig(directory, text, filePath);
			default:
				return null;
		}
	} catch (_) {
		return null;
	}
}

async function loadPrettierFromPackageJson(directory) {
	try {
		const pkgPath = Url.join(directory, "package.json");
		const fs = fsOperation(pkgPath);
		if (!(await fs.exists())) return null;
		const pkg = await fs.readFile("json");
		const config = pkg?.prettier;
		if (config && typeof config === "object") return config;
	} catch (_) {
		return null;
	}
	return null;
}

function parseJsonLike(text) {
	const trimmed = text?.trim();
	if (!trimmed) return null;
	const parsed = helpers.parseJSON(trimmed);
	if (parsed) return parsed;
	try {
		return parseSafeExpression(trimmed);
	} catch (_) {
		return null;
	}
}

function parseJsConfig(directory, source, absolutePath) {
	if (!source) return null;
	void directory;
	void absolutePath;
	try {
		return extractConfigFromProgram(source);
	} catch (_) {
		return null;
	}
}

function parseProgram(source) {
	try {
		return parse(source, {
			ecmaVersion: "latest",
			sourceType: "module",
			allowHashBang: true,
		});
	} catch (_) {
		return parse(source, {
			ecmaVersion: "latest",
			sourceType: "script",
			allowHashBang: true,
		});
	}
}

function extractConfigFromProgram(source) {
	const ast = parseProgram(source);
	const scope = new Map();

	for (const statement of ast.body) {
		const declared = readVariableDeclaration(statement, scope);
		if (declared) {
			for (const [name, value] of declared) {
				scope.set(name, value);
			}
			continue;
		}

		const exported = readCommonJsExport(statement, scope);
		if (exported !== undefined) return exported;

		const esmExported = readEsmExport(statement, scope);
		if (esmExported !== undefined) return esmExported;
	}

	return null;
}

function parseSafeExpression(text) {
	const wrapped = `(${text})`;
	const ast = parse(wrapped, {
		ecmaVersion: "latest",
		sourceType: "module",
		allowHashBang: true,
	});
	const statement = ast.body[0];
	if (statement?.type !== "ExpressionStatement") return null;
	return evaluateNode(statement.expression, new Map());
}

function readVariableDeclaration(statement, scope) {
	if (statement?.type !== "VariableDeclaration") return null;
	const values = new Map();
	const lookupScope = new Map(scope);

	for (const decl of statement.declarations || []) {
		if (!decl || decl.type !== "VariableDeclarator") continue;
		if (decl.id?.type !== "Identifier") continue;
		if (!decl.init) continue;
		try {
			const value = evaluateNode(decl.init, lookupScope);
			values.set(decl.id.name, value);
			lookupScope.set(decl.id.name, value);
		} catch (_) {
			// Ignore unsupported declarations
		}
	}

	return values.size ? values : null;
}

function readCommonJsExport(statement, scope) {
	if (statement?.type !== "ExpressionStatement") return undefined;
	const expr = statement.expression;
	if (expr?.type !== "AssignmentExpression" || expr.operator !== "=") {
		return undefined;
	}

	if (!isModuleExports(expr.left)) return undefined;
	return evaluateNode(expr.right, scope);
}

function readEsmExport(statement, scope) {
	if (statement?.type !== "ExportDefaultDeclaration") return undefined;
	return evaluateNode(statement.declaration, scope);
}

function isModuleExports(node) {
	return (
		node?.type === "MemberExpression" &&
		!node.computed &&
		node.object?.type === "Identifier" &&
		node.object.name === "module" &&
		node.property?.type === "Identifier" &&
		node.property.name === "exports"
	);
}

function evaluateNode(node, scope) {
	if (!node) return null;

	switch (node.type) {
		case "ObjectExpression":
			return evaluateObjectExpression(node, scope);
		case "ArrayExpression":
			return node.elements.map((entry) => evaluateNode(entry, scope));
		case "Literal":
			return node.value;
		case "TemplateLiteral":
			if (node.expressions.length) {
				throw new Error("Template expressions are not supported");
			}
			return node.quasis.map((part) => part.value.cooked ?? "").join("");
		case "Identifier":
			if (scope.has(node.name)) return scope.get(node.name);
			if (node.name === "undefined") return undefined;
			throw new Error(`Unsupported identifier: ${node.name}`);
		case "UnaryExpression":
			return evaluateUnaryExpression(node, scope);
		default:
			throw new Error(`Unsupported node type: ${node.type}`);
	}
}

function evaluateObjectExpression(node, scope) {
	const output = {};
	for (const property of node.properties || []) {
		if (!property || property.type !== "Property") {
			throw new Error("Unsupported object property");
		}
		if (property.kind !== "init" || property.method || property.shorthand) {
			throw new Error("Unsupported object property kind");
		}
		const key = property.computed
			? evaluateNode(property.key, scope)
			: getPropertyKey(property.key);
		const normalizedKey =
			typeof key === "string" || typeof key === "number" ? String(key) : null;
		if (!normalizedKey) {
			throw new Error("Unsupported object key");
		}
		output[normalizedKey] = evaluateNode(property.value, scope);
	}
	return output;
}

function getPropertyKey(node) {
	if (node?.type === "Identifier") return node.name;
	if (node?.type === "Literal") return node.value;
	throw new Error("Unsupported property key");
}

function evaluateUnaryExpression(node, scope) {
	const value = evaluateNode(node.argument, scope);
	switch (node.operator) {
		case "+":
			return +value;
		case "-":
			return -value;
		case "!":
			return !value;
		default:
			throw new Error(`Unsupported unary operator: ${node.operator}`);
	}
}

function normalizePath(path) {
	let result = String(path || "").replace(/\\/g, "/");
	while (result.length > 1 && result.endsWith("/")) {
		const prefix = result.slice(0, -1);
		if (/^[a-z]+:\/{0,2}$/i.test(prefix)) break;
		result = prefix;
	}
	return result;
}

function pathsAreSame(a, b) {
	if (!a || !b) return false;
	return normalizePath(a) === normalizePath(b);
}
