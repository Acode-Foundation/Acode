import { defineBundle, defineServer, installers } from "../providerUtils";
import type { LspServerBundle, LspServerManifest } from "../types";
import { resolveJsTsLanguageId } from "./shared";

export const javascriptServers: LspServerManifest[] = [
	defineServer({
		id: "typescript",
		label: "TypeScript / JavaScript (Web Worker)",
		useWorkspaceFolders: true,
		languages: [
			"javascript",
			"javascriptreact",
			"typescript",
			"typescriptreact",
			"tsx",
			"jsx",
		],
		runtimes: ["web-worker"],
		transport: { kind: "external" },
		enabled: true,
		resolveLanguageId: ({ languageId, languageName }) =>
			resolveJsTsLanguageId(languageId, languageName),
	}),
	defineServer({
		id: "typescript-native",
		label: "TypeScript 7 / JavaScript (Native STDIO)",
		useWorkspaceFolders: false,
		languages: [
			"javascript",
			"javascriptreact",
			"typescript",
			"typescriptreact",
			"tsx",
			"jsx",
		],
		runtimes: ["builtin-alpine"],
		transport: {
			kind: "websocket",
		},
		command: "tsc",
		args: ["--lsp", "--stdio"],
		checkCommand: "which tsc && tsc --version | grep -q '^Version 7\\.'",
		versionCommand: "tsc --version",
		installer: installers.npm({
			executable: "tsc",
			packages: ["@typescript/native@npm:typescript@^7.0.2"],
		}),
		logOutput: "warnings-and-errors",
		enabled: false,
		initializationOptions: {
			provideFormatter: true,
			hostInfo: "acode",
		},
		workspaceConfiguration: {
			completions: {
				completeFunctionCalls: true,
			},
		},
		clientConfig: {
			timeout: 15000,
		},
		resolveLanguageId: ({ languageId, languageName }) =>
			resolveJsTsLanguageId(languageId, languageName),
	}),
	defineServer({
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
		runtimes: ["builtin-alpine"],
		transport: {
			kind: "websocket",
		},
		command: "vtsls",
		args: ["--stdio"],
		checkCommand: "which vtsls",
		installer: installers.npm({
			executable: "vtsls",
			packages: ["@vtsls/language-server"],
		}),
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
	}),
	defineServer({
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
		command: "vscode-eslint-language-server",
		args: ["--stdio"],
		checkCommand: "which vscode-eslint-language-server",
		installer: installers.npm({
			executable: "vscode-eslint-language-server",
			packages: ["vscode-langservers-extracted"],
		}),
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
	}),
];

export const javascriptBundle: LspServerBundle = defineBundle({
	id: "builtin-javascript",
	label: "JavaScript / TypeScript",
	servers: javascriptServers,
});
