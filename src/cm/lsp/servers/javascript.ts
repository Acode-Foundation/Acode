import { defineBundle, defineServer, installers } from "../providerUtils";
import type { LspServerBundle, LspServerManifest } from "../types";
import { resolveJsTsLanguageId } from "./shared";

export const javascriptServers: LspServerManifest[] = [
	defineServer({
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
		command: "typescript-language-server",
		args: ["--stdio"],
		checkCommand: "which typescript-language-server",
		installer: installers.npm({
			executable: "typescript-language-server",
			packages: ["typescript-language-server", "typescript"],
		}),
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
