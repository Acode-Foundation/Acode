import type {
	AcodeClientConfig,
	BridgeConfig,
	LanguageResolverContext,
	LauncherConfig,
	LspServerDefinition,
	RegistryEventListener,
	RegistryEventType,
	RootUriContext,
	TransportDescriptor,
	WebSocketTransportOptions,
} from "./types";

const registry = new Map<string, LspServerDefinition>();
const listeners = new Set<RegistryEventListener>();

function toKey(id: string | undefined | null): string {
	return String(id ?? "")
		.trim()
		.toLowerCase();
}

function clone<T>(value: T): T | undefined {
	if (!value || typeof value !== "object") return undefined;
	try {
		return JSON.parse(JSON.stringify(value)) as T;
	} catch (_) {
		return value;
	}
}

function sanitizeLanguages(languages: string[] = []): string[] {
	if (!Array.isArray(languages)) return [];
	return languages
		.map((lang) =>
			String(lang ?? "")
				.trim()
				.toLowerCase(),
		)
		.filter(Boolean);
}

function parsePort(value: unknown): number | null {
	const num = Number(value);
	if (!Number.isFinite(num)) return null;
	const int = Math.floor(num);
	if (int !== num || int <= 0 || int > 65535) return null;
	return int;
}

interface RawBridgeConfig {
	kind?: string;
	port?: unknown;
	command?: string;
	args?: unknown[];
	session?: string;
}

function sanitizeBridge(
	serverId: string,
	bridge: RawBridgeConfig | undefined | null,
): BridgeConfig | undefined {
	if (!bridge || typeof bridge !== "object") return undefined;
	const kind = bridge.kind ?? "axs";
	if (kind !== "axs") {
		throw new Error(
			`LSP server ${serverId} declares unsupported bridge kind ${kind}`,
		);
	}
	// Port is now optional - if not provided, auto-port discovery will be used
	const port = bridge.port ? (parsePort(bridge.port) ?? undefined) : undefined;
	const command = bridge.command ? String(bridge.command) : null;
	if (!command) {
		throw new Error(`LSP server ${serverId} bridge must supply a command`);
	}
	const args = Array.isArray(bridge.args)
		? bridge.args.map((arg) => String(arg))
		: undefined;
	return {
		kind: "axs",
		port,
		command,
		args,
		session: bridge.session ? String(bridge.session) : undefined,
	};
}

interface RawTransportDescriptor {
	kind?: string;
	command?: string;
	args?: unknown[];
	options?: Record<string, unknown> | WebSocketTransportOptions;
	url?: string;
}

interface RawLauncherConfig {
	command?: string;
	args?: unknown[];
	startCommand?: string | string[];
	checkCommand?: string;
	install?: { command?: string };
	bridge?: RawBridgeConfig;
}

interface RawServerDefinition {
	id?: string;
	label?: string;
	enabled?: boolean;
	languages?: string[];
	transport?: RawTransportDescriptor | TransportDescriptor;
	initializationOptions?: Record<string, unknown>;
	clientConfig?: Record<string, unknown> | AcodeClientConfig;
	startupTimeout?: number;
	capabilityOverrides?: Record<string, unknown>;
	rootUri?:
		| ((uri: string, context: unknown) => string | null)
		| ((uri: string, context: RootUriContext) => string | null)
		| null;
	resolveLanguageId?:
		| ((context: LanguageResolverContext) => string | null)
		| null;
	launcher?: RawLauncherConfig | LauncherConfig;
	useWorkspaceFolders?: boolean;
}

function sanitizeDefinition(
	definition: RawServerDefinition,
): LspServerDefinition {
	if (!definition || typeof definition !== "object") {
		throw new TypeError("LSP server definition must be an object");
	}

	const id = toKey(definition.id);
	if (!id) throw new Error("LSP server definition requires a non-empty id");

	const transport: RawTransportDescriptor = definition.transport ?? {};
	const kind = (transport.kind ?? "stdio") as
		| "stdio"
		| "websocket"
		| "external";

	if (!transport || typeof transport !== "object") {
		throw new Error(`LSP server ${id} is missing a transport descriptor`);
	}

	if (
		!("languages" in definition) ||
		!sanitizeLanguages(definition.languages).length
	) {
		throw new Error(`LSP server ${id} must declare supported languages`);
	}

	if (kind === "stdio" && !transport.command) {
		throw new Error(`LSP server ${id} (stdio) requires a command`);
	}

	// Websocket transport requires a URL unless a bridge is configured for auto-port discovery
	const hasBridge = definition.launcher?.bridge?.command;
	if (kind === "websocket" && !transport.url && !hasBridge) {
		throw new Error(
			`LSP server ${id} (websocket) requires a url or a launcher bridge`,
		);
	}

	const transportOptions: Record<string, unknown> =
		transport.options && typeof transport.options === "object"
			? { ...transport.options }
			: {};

	const sanitizedTransport: TransportDescriptor = {
		kind,
		command: transport.command,
		args: Array.isArray(transport.args)
			? transport.args.map((arg) => String(arg))
			: undefined,
		options: transportOptions,
		url: transport.url,
		protocols: undefined,
	};

	let launcher: LauncherConfig | undefined;
	if (definition.launcher && typeof definition.launcher === "object") {
		const rawLauncher = definition.launcher;
		launcher = {
			command: rawLauncher.command,
			args: Array.isArray(rawLauncher.args)
				? rawLauncher.args.map((arg) => String(arg))
				: undefined,
			startCommand: Array.isArray(rawLauncher.startCommand)
				? rawLauncher.startCommand.map((arg) => String(arg))
				: rawLauncher.startCommand,
			checkCommand: rawLauncher.checkCommand,
			install:
				rawLauncher.install && typeof rawLauncher.install === "object"
					? {
							command: rawLauncher.install.command ?? "",
						}
					: undefined,
			bridge: sanitizeBridge(id, rawLauncher.bridge),
		};
	}

	const sanitized: LspServerDefinition = {
		id,
		label: definition.label ?? id,
		enabled: definition.enabled !== false,
		languages: sanitizeLanguages(definition.languages),
		transport: sanitizedTransport,
		initializationOptions: clone(definition.initializationOptions),
		clientConfig: clone(definition.clientConfig),
		startupTimeout:
			typeof definition.startupTimeout === "number"
				? definition.startupTimeout
				: undefined,
		capabilityOverrides: clone(definition.capabilityOverrides),
		rootUri:
			typeof definition.rootUri === "function" ? definition.rootUri : null,
		resolveLanguageId:
			typeof definition.resolveLanguageId === "function"
				? definition.resolveLanguageId
				: null,
		launcher,
		useWorkspaceFolders: definition.useWorkspaceFolders === true,
	};

	if (!Object.keys(transportOptions).length) {
		sanitized.transport.options = undefined;
	}

	return sanitized;
}

function resolveJsTsLanguageId(
	languageId: string | undefined,
	languageName: string | undefined,
): string | null {
	const lang = toKey(languageId ?? languageName);
	switch (lang) {
		case "tsx":
		case "typescriptreact":
			return "typescriptreact";
		case "jsx":
		case "javascriptreact":
			return "javascriptreact";
		case "ts":
			return "typescript";
		case "js":
			return "javascript";
		default:
			return lang || null;
	}
}

function notify(event: RegistryEventType, payload: LspServerDefinition): void {
	listeners.forEach((fn) => {
		try {
			fn(event, payload);
		} catch (error) {
			console.error("LSP server registry listener failed", error);
		}
	});
}

export interface RegisterServerOptions {
	replace?: boolean;
}

export function registerServer(
	definition: RawServerDefinition,
	options: RegisterServerOptions = {},
): LspServerDefinition {
	const { replace = false } = options;
	const normalized = sanitizeDefinition(definition);
	const exists = registry.has(normalized.id);
	if (exists && !replace) {
		const existing = registry.get(normalized.id);
		if (existing) return existing;
	}

	registry.set(normalized.id, normalized);
	notify("register", normalized);
	return normalized;
}

export function unregisterServer(id: string): boolean {
	const key = toKey(id);
	if (!key || !registry.has(key)) return false;
	const existing = registry.get(key);
	registry.delete(key);
	if (existing) {
		notify("unregister", existing);
	}
	return true;
}

export type ServerUpdater = (
	current: LspServerDefinition,
) => Partial<LspServerDefinition> | null;

export function updateServer(
	id: string,
	updater: ServerUpdater,
): LspServerDefinition | null {
	const key = toKey(id);
	if (!key || !registry.has(key)) return null;
	const current = registry.get(key);
	if (!current) return null;
	const next = updater({ ...current });
	if (!next) return current;
	const normalized = sanitizeDefinition({
		...current,
		...next,
		id: current.id,
	});
	registry.set(key, normalized);
	notify("update", normalized);
	return normalized;
}

export function getServer(id: string): LspServerDefinition | null {
	return registry.get(toKey(id)) ?? null;
}

export function listServers(): LspServerDefinition[] {
	return Array.from(registry.values());
}

export interface GetServersOptions {
	includeDisabled?: boolean;
}

export function getServersForLanguage(
	languageId: string,
	options: GetServersOptions = {},
): LspServerDefinition[] {
	const { includeDisabled = false } = options;
	const langKey = toKey(languageId);
	if (!langKey) return [];

	return listServers().filter((server) => {
		if (!includeDisabled && !server.enabled) return false;
		return server.languages.includes(langKey);
	});
}

export function onRegistryChange(listener: RegistryEventListener): () => void {
	if (typeof listener !== "function") return () => {};
	listeners.add(listener);
	return () => listeners.delete(listener);
}

function registerBuiltinServers(): void {
	const defaults: RawServerDefinition[] = [
		{
			id: "typescript",
			label: "TypeScript / JavaScript",
			useWorkspaceFolders: true,
			languages: [
				"javascript",
				"javascriptreact",
				"typescript",
				"typescriptreact",
				"tsx",
				"jsx",
			],
			transport: {
				kind: "websocket",
			},
			launcher: {
				bridge: {
					kind: "axs",
					command: "typescript-language-server",
					args: ["--stdio"],
				},
				checkCommand: "which typescript-language-server",
				install: {
					command:
						"apk add --no-cache nodejs npm && npm install -g typescript-language-server typescript",
				},
			},
			enabled: true,
			initializationOptions: {
				provideFormatter: true,
				hostInfo: "acode",
				tsserver: {
					maxTsServerMemory: 4096,
					useSeparateSyntaxServer: true,
				},
				preferences: {
					includeInlayParameterNameHints: "all",
					includeInlayParameterNameHintsWhenArgumentMatchesName: true,
					includeInlayFunctionParameterTypeHints: true,
					includeInlayVariableTypeHints: true,
					includeInlayVariableTypeHintsWhenTypeMatchesName: false,
					includeInlayPropertyDeclarationTypeHints: true,
					includeInlayFunctionLikeReturnTypeHints: true,
					includeInlayEnumMemberValueHints: true,
					importModuleSpecifierPreference: "shortest",
					importModuleSpecifierEnding: "auto",
					includePackageJsonAutoImports: "auto",
					provideRefactorNotApplicableReason: true,
					allowIncompleteCompletions: true,
					allowRenameOfImportPath: true,
					generateReturnInDocTemplate: true,
					organizeImportsIgnoreCase: "auto",
					organizeImportsCollation: "ordinal",
					organizeImportsCollationConfig: "default",
					autoImportFileExcludePatterns: [],
					preferTypeOnlyAutoImports: false,
				},
				completions: {
					completeFunctionCalls: true,
				},
				diagnostics: {
					reportStyleChecksAsWarnings: true,
				},
			},
			resolveLanguageId: ({ languageId, languageName }) =>
				resolveJsTsLanguageId(languageId, languageName),
		},
		{
			id: "vtsls",
			label: "TypeScript / JavaScript (vtsls)",
			useWorkspaceFolders: true,
			languages: [
				"javascript",
				"javascriptreact",
				"typescript",
				"typescriptreact",
				"tsx",
				"jsx",
			],
			transport: {
				kind: "websocket",
			},
			launcher: {
				bridge: {
					kind: "axs",
					command: "vtsls",
					args: ["--stdio"],
				},
				checkCommand: "which vtsls",
				install: {
					command:
						"apk add --no-cache nodejs npm && npm install -g @vtsls/language-server",
				},
			},
			enabled: false,
			initializationOptions: {
				hostInfo: "acode",
				typescript: {
					enablePromptUseWorkspaceTsdk: true,
					inlayHints: {
						parameterNames: {
							enabled: "all",
							suppressWhenArgumentMatchesName: false,
						},
						parameterTypes: {
							enabled: true,
						},
						variableTypes: {
							enabled: true,
							suppressWhenTypeMatchesName: false,
						},
						propertyDeclarationTypes: {
							enabled: true,
						},
						functionLikeReturnTypes: {
							enabled: true,
						},
						enumMemberValues: {
							enabled: true,
						},
					},
					suggest: {
						completeFunctionCalls: true,
						includeCompletionsForModuleExports: true,
						includeCompletionsWithInsertText: true,
						includeAutomaticOptionalChainCompletions: true,
						includeCompletionsWithSnippetText: true,
						includeCompletionsWithClassMemberSnippets: true,
						includeCompletionsWithObjectLiteralMethodSnippets: true,
						autoImports: true,
						classMemberSnippets: {
							enabled: true,
						},
						objectLiteralMethodSnippets: {
							enabled: true,
						},
					},
					preferences: {
						importModuleSpecifier: "shortest",
						importModuleSpecifierEnding: "auto",
						includePackageJsonAutoImports: "auto",
						preferTypeOnlyAutoImports: false,
						quoteStyle: "auto",
						jsxAttributeCompletionStyle: "auto",
					},
					format: {
						enable: true,
						insertSpaceAfterCommaDelimiter: true,
						insertSpaceAfterSemicolonInForStatements: true,
						insertSpaceBeforeAndAfterBinaryOperators: true,
						insertSpaceAfterKeywordsInControlFlowStatements: true,
						insertSpaceAfterFunctionKeywordForAnonymousFunctions: false,
						insertSpaceAfterOpeningAndBeforeClosingNonemptyParenthesis: false,
						insertSpaceAfterOpeningAndBeforeClosingNonemptyBrackets: false,
						insertSpaceAfterOpeningAndBeforeClosingNonemptyBraces: true,
						insertSpaceAfterOpeningAndBeforeClosingTemplateStringBraces: false,
						insertSpaceAfterOpeningAndBeforeClosingJsxExpressionBraces: false,
						placeOpenBraceOnNewLineForFunctions: false,
						placeOpenBraceOnNewLineForControlBlocks: false,
						semicolons: "ignore",
					},
					updateImportsOnFileMove: {
						enabled: "always",
					},
					codeActionsOnSave: {
						organizeImports: false,
						addMissingImports: false,
					},
					workspaceSymbols: {
						scope: "allOpenProjects",
					},
				},
				javascript: {
					inlayHints: {
						parameterNames: {
							enabled: "all",
							suppressWhenArgumentMatchesName: false,
						},
						parameterTypes: {
							enabled: true,
						},
						variableTypes: {
							enabled: true,
							suppressWhenTypeMatchesName: false,
						},
						propertyDeclarationTypes: {
							enabled: true,
						},
						functionLikeReturnTypes: {
							enabled: true,
						},
						enumMemberValues: {
							enabled: true,
						},
					},
					suggest: {
						completeFunctionCalls: true,
						includeCompletionsForModuleExports: true,
						autoImports: true,
						classMemberSnippets: {
							enabled: true,
						},
					},
					preferences: {
						importModuleSpecifier: "shortest",
						quoteStyle: "auto",
					},
					format: {
						enable: true,
					},
					updateImportsOnFileMove: {
						enabled: "always",
					},
				},
				tsserver: {
					maxTsServerMemory: 8092,
				},
				vtsls: {
					experimental: {
						completion: {
							enableServerSideFuzzyMatch: true,
							entriesLimit: 5000,
						},
					},
					autoUseWorkspaceTsdk: true,
				},
			},
			resolveLanguageId: ({ languageId, languageName }) =>
				resolveJsTsLanguageId(languageId, languageName),
		},
		{
			id: "python",
			label: "Python (pylsp)",
			languages: ["python"],
			transport: {
				kind: "websocket",
			},
			launcher: {
				bridge: {
					kind: "axs",
					command: "pylsp",
				},
				checkCommand: "which pylsp",
				install: {
					command:
						"apk update && apk upgrade && apk add python3 py3-pip && PIP_BREAK_SYSTEM_PACKAGES=1 pip install 'python-lsp-server[all]'",
				},
			},
			initializationOptions: {
				pylsp: {
					plugins: {
						pyflakes: { enabled: true },
						pycodestyle: { enabled: true },
						mccabe: { enabled: true },
					},
				},
			},
			enabled: true,
		},
		{
			id: "eslint",
			label: "ESLint",
			languages: [
				"javascript",
				"javascriptreact",
				"typescript",
				"typescriptreact",
				"tsx",
				"jsx",
				"vue",
				"svelte",
				"html",
				"markdown",
				"json",
				"jsonc",
			],
			transport: {
				kind: "websocket",
			},
			launcher: {
				bridge: {
					kind: "axs",
					command: "vscode-eslint-language-server",
					args: ["--stdio"],
				},
				checkCommand: "which vscode-eslint-language-server",
				install: {
					command:
						"apk add --no-cache nodejs npm && npm install -g vscode-langservers-extracted",
				},
			},
			enabled: false,
			initializationOptions: {
				validate: "on",
				rulesCustomizations: [],
				run: "onType",
				nodePath: null,
				workingDirectory: {
					mode: "auto",
				},
				problems: {
					shortenToSingleLine: false,
				},
				codeActionOnSave: {
					enable: true,
					rules: [],
					mode: "all",
				},
				codeAction: {
					disableRuleComment: {
						enable: true,
						location: "separateLine",
						commentStyle: "line",
					},
					showDocumentation: {
						enable: true,
					},
				},
				experimental: {
					useFlatConfig: false,
				},
				format: {
					enable: true,
				},
				quiet: false,
				onIgnoredFiles: "off",
				useESLintClass: false,
			},
			clientConfig: {
				builtinExtensions: {
					hover: false,
					completion: false,
					signature: false,
					keymaps: false,
					diagnostics: true,
				},
			},
			resolveLanguageId: ({ languageId, languageName }) =>
				resolveJsTsLanguageId(languageId, languageName),
		},
		{
			id: "clangd",
			label: "C / C++ (clangd)",
			languages: ["c", "cpp"],
			transport: {
				kind: "websocket",
			},
			launcher: {
				bridge: {
					kind: "axs",
					command: "clangd",
				},
				checkCommand: "which clangd",
				install: {
					command: "apk add --no-cache clang-extra-tools",
				},
			},
			enabled: false,
		},
		{
			id: "html",
			label: "HTML",
			languages: ["html", "vue", "svelte"],
			transport: {
				kind: "websocket",
			},
			launcher: {
				bridge: {
					kind: "axs",
					command: "vscode-html-language-server",
					args: ["--stdio"],
				},
				checkCommand: "which vscode-html-language-server",
				install: {
					command:
						"apk add --no-cache nodejs npm && npm install -g vscode-langservers-extracted",
				},
			},
			enabled: true,
		},
		{
			id: "css",
			label: "CSS",
			languages: ["css", "scss", "less"],
			transport: {
				kind: "websocket",
			},
			launcher: {
				bridge: {
					kind: "axs",
					command: "vscode-css-language-server",
					args: ["--stdio"],
				},
				checkCommand: "which vscode-css-language-server",
				install: {
					command:
						"apk add --no-cache nodejs npm && npm install -g vscode-langservers-extracted",
				},
			},
			enabled: true,
		},
		{
			id: "json",
			label: "JSON",
			languages: ["json", "jsonc"],
			transport: {
				kind: "websocket",
			},
			launcher: {
				bridge: {
					kind: "axs",
					command: "vscode-json-language-server",
					args: ["--stdio"],
				},
				checkCommand: "which vscode-json-language-server",
				install: {
					command:
						"apk add --no-cache nodejs npm && npm install -g vscode-langservers-extracted",
				},
			},
			enabled: true,
		},
		{
			id: "gopls",
			label: "Go (gopls)",
			languages: ["go", "go.mod", "go.sum", "gotmpl"],
			transport: {
				kind: "websocket",
			},
			launcher: {
				bridge: {
					kind: "axs",
					command: "gopls",
					args: ["serve"],
				},
				checkCommand: "which gopls",
				install: {
					command: "apk add --no-cache go gopls",
				},
			},
			initializationOptions: {
				usePlaceholders: false,
				completeUnimported: true,
				deepCompletion: true,
				completionBudget: "100ms",
				matcher: "Fuzzy",
				staticcheck: true,
				gofumpt: true,
				hints: {
					assignVariableTypes: true,
					compositeLiteralFields: true,
					compositeLiteralTypes: true,
					constantValues: true,
					functionTypeParameters: true,
					parameterNames: true,
					rangeVariableTypes: true,
				},
				diagnosticsDelay: "250ms",
				diagnosticsTrigger: "Edit",
				annotations: {
					bounds: true,
					escape: true,
					inline: true,
					nil: true,
				},
				semanticTokens: true,
				analyses: {
					nilness: true,
					unusedparams: true,
					unusedvariable: true,
					unusedwrite: true,
					shadow: true,
					fieldalignment: false,
					stringintconv: true,
				},
				importShortcut: "Both",
				symbolMatcher: "FastFuzzy",
				symbolStyle: "Dynamic",
				symbolScope: "all",
				local: "",
				linksInHover: true,
				hoverKind: "FullDocumentation",
				verboseOutput: false,
			},
			enabled: true,
		},
		{
			id: "rust-analyzer",
			label: "Rust (rust-analyzer)",
			useWorkspaceFolders: true,
			languages: ["rust"],
			transport: {
				kind: "websocket",
			},
			launcher: {
				bridge: {
					kind: "axs",
					command: "rust-analyzer",
				},
				checkCommand: "which rust-analyzer",
				install: {
					command: "apk add --no-cache rust cargo rust-analyzer",
				},
			},
			initializationOptions: {
				cargo: {
					allFeatures: true,
					buildScripts: {
						enable: true,
					},
					loadOutDirsFromCheck: true,
				},
				procMacro: {
					enable: true,
					attributes: {
						enable: true,
					},
				},
				checkOnSave: {
					enable: true,
					command: "clippy",
					extraArgs: ["--no-deps"],
				},
				diagnostics: {
					enable: true,
					experimental: {
						enable: true,
					},
				},
				inlayHints: {
					bindingModeHints: {
						enable: false,
					},
					chainingHints: {
						enable: true,
					},
					closingBraceHints: {
						enable: true,
						minLines: 25,
					},
					closureReturnTypeHints: {
						enable: "with_block",
					},
					lifetimeElisionHints: {
						enable: "skip_trivial",
						useParameterNames: true,
					},
					maxLength: 25,
					parameterHints: {
						enable: true,
					},
					reborrowHints: {
						enable: "mutable",
					},
					typeHints: {
						enable: true,
						hideClosureInitialization: false,
						hideNamedConstructor: false,
					},
				},
				lens: {
					enable: true,
					debug: {
						enable: true,
					},
					implementations: {
						enable: true,
					},
					references: {
						adt: { enable: false },
						enumVariant: { enable: false },
						method: { enable: false },
						trait: { enable: false },
					},
					run: {
						enable: true,
					},
				},
				completion: {
					autoimport: {
						enable: true,
					},
					autoself: {
						enable: true,
					},
					callable: {
						snippets: "fill_arguments",
					},
					postfix: {
						enable: true,
					},
					privateEditable: {
						enable: false,
					},
				},
				semanticHighlighting: {
					doc: {
						comment: {
							inject: {
								enable: true,
							},
						},
					},
					operator: {
						enable: true,
						specialization: {
							enable: true,
						},
					},
					punctuation: {
						enable: false,
						separate: {
							macro: {
								bang: true,
							},
						},
						specialization: {
							enable: true,
						},
					},
					strings: {
						enable: true,
					},
				},
				hover: {
					actions: {
						debug: {
							enable: true,
						},
						enable: true,
						gotoTypeDef: {
							enable: true,
						},
						implementations: {
							enable: true,
						},
						references: {
							enable: true,
						},
						run: {
							enable: true,
						},
					},
					documentation: {
						enable: true,
					},
					links: {
						enable: true,
					},
				},
				workspace: {
					symbol: {
						search: {
							kind: "all_symbols",
							scope: "workspace",
						},
					},
				},
				rustfmt: {
					extraArgs: [],
					overrideCommand: null,
					rangeFormatting: {
						enable: false,
					},
				},
			},
			enabled: true,
		},
	];

	defaults.forEach((def) => {
		try {
			registerServer(def, { replace: false });
		} catch (error) {
			console.error("Failed to register builtin LSP server", def.id, error);
		}
	});
}

registerBuiltinServers();

export default {
	registerServer,
	unregisterServer,
	updateServer,
	getServer,
	getServersForLanguage,
	listServers,
	onRegistryChange,
};
