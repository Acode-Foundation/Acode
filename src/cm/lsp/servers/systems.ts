import { defineBundle, defineServer, installers } from "../providerUtils";
import type { LspServerBundle, LspServerManifest } from "../types";

export const systemsServers: LspServerManifest[] = [
	defineServer({
		id: "clangd",
		label: "C / C++ (clangd)",
		languages: ["c", "cpp"],
		command: "clangd",
		checkCommand: "which clangd",
		installer: installers.apk({
			executable: "clangd",
			packages: ["clang-extra-tools"],
		}),
		enabled: false,
	}),
	defineServer({
		id: "gopls",
		label: "Go (gopls)",
		languages: ["go", "go.mod", "go.sum", "gotmpl"],
		command: "gopls",
		args: ["serve"],
		checkCommand: "which gopls",
		installer: installers.apk({
			executable: "gopls",
			packages: ["go", "gopls"],
		}),
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
	}),
	defineServer({
		id: "rust-analyzer",
		label: "Rust (rust-analyzer)",
		useWorkspaceFolders: true,
		languages: ["rust"],
		command: "rust-analyzer",
		checkCommand: "which rust-analyzer",
		installer: installers.apk({
			executable: "rust-analyzer",
			packages: ["rust", "cargo", "rust-analyzer"],
		}),
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
	}),
];

export const systemsBundle: LspServerBundle = defineBundle({
	id: "builtin-systems",
	label: "Systems",
	servers: systemsServers,
});
