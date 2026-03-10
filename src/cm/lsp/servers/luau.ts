import toast from "components/toast";
import confirm from "dialogs/confirm";
import loader from "dialogs/loader";
import { buildShellArchCase } from "../installerUtils";
import {
	quoteArg,
	runForegroundCommand,
	runQuickCommand,
} from "../installRuntime";
import { defineBundle, defineServer, installers } from "../providerUtils";
import type {
	InstallCheckResult,
	LspServerBundle,
	LspServerManifest,
} from "../types";

function isGlibcRuntimeError(output: string): boolean {
	return (
		output.includes("ld-linux-aarch64.so.1") ||
		output.includes("ld-linux-x86-64.so.2") ||
		output.includes("Error loading shared library") ||
		output.includes("__fprintf_chk") ||
		output.includes("__snprintf_chk") ||
		output.includes("__vsnprintf_chk") ||
		output.includes("__libc_single_threaded") ||
		output.includes("GLIBC_")
	);
}

function getLuauRuntimeFailureMessage(output: string): string {
	if (isGlibcRuntimeError(output)) {
		return "Luau release binary requires glibc and is not runnable in this Alpine/musl environment.";
	}

	const firstLine = String(output || "")
		.split("\n")
		.map((line) => line.trim())
		.find(Boolean);
	return firstLine || "Luau binary is installed but not runnable.";
}

async function readLuauRuntimeFailure(binaryPath: string): Promise<string> {
	const command = `${quoteArg(binaryPath)} --help >/dev/null 2>&1 || ${quoteArg(binaryPath)} lsp --help >/dev/null 2>&1`;
	try {
		await runQuickCommand(command);
		return "";
	} catch (error) {
		const primaryMessage =
			error instanceof Error ? error.message : String(error);
		try {
			const lddOutput = await runQuickCommand(
				`command -v ldd >/dev/null 2>&1 && ldd ${quoteArg(binaryPath)} 2>&1 || true`,
			);
			return [primaryMessage, lddOutput].filter(Boolean).join("\n");
		} catch {
			return primaryMessage;
		}
	}
}

export const luauServers: LspServerManifest[] = [
	defineServer({
		id: "luau",
		label: "Luau",
		useWorkspaceFolders: true,
		languages: ["luau"],
		command: "/usr/local/bin/luau-lsp",
		args: ["lsp"],
		installer: installers.githubRelease({
			repo: "JohnnyMorganz/luau-lsp",
			binaryPath: "/usr/local/bin/luau-lsp",
			assetNames: {
				aarch64: "luau-lsp-linux-arm64.zip",
				arm64: "luau-lsp-linux-arm64.zip",
				"arm64-v8a": "luau-lsp-linux-arm64.zip",
				x86_64: "luau-lsp-linux-x86_64.zip",
				amd64: "luau-lsp-linux-x86_64.zip",
			},
			extractFile: "luau-lsp",
		}),
		enabled: false,
	}),
];

export const luauBundle: LspServerBundle = defineBundle({
	id: "builtin-luau",
	label: "Luau",
	servers: luauServers,
	hooks: {
		getExecutable: (_, manifest) =>
			manifest.launcher?.install?.binaryPath ||
			manifest.launcher?.install?.executable ||
			null,
		async checkInstallation(_, manifest): Promise<InstallCheckResult> {
			const binary =
				manifest.launcher?.install?.binaryPath ||
				manifest.launcher?.install?.executable;
			if (!binary) {
				return {
					status: "failed",
					version: null,
					canInstall: true,
					canUpdate: true,
					message: "Luau bundle is missing a binary path",
				};
			}

			try {
				await runQuickCommand(`test -x ${quoteArg(binary)}`);
				const runtimeFailure = await readLuauRuntimeFailure(binary);
				if (runtimeFailure) {
					return {
						status: "failed",
						version: null,
						canInstall: true,
						canUpdate: true,
						message: getLuauRuntimeFailureMessage(runtimeFailure),
					};
				}
				return {
					status: "present",
					version: null,
					canInstall: true,
					canUpdate: true,
				};
			} catch (error) {
				return {
					status: "missing",
					version: null,
					canInstall: true,
					canUpdate: true,
					message: error instanceof Error ? error.message : String(error),
				};
			}
		},
		async installServer(_, manifest, mode, options = {}): Promise<boolean> {
			const { promptConfirm = true } = options;
			const install = manifest.launcher?.install;
			const assetCases = buildShellArchCase(install?.assetNames, quoteArg);
			const binaryPath = install?.binaryPath;
			const repo = install?.repo;
			if (!assetCases || !binaryPath || !repo) {
				throw new Error("Luau bundle is missing release metadata");
			}

			const label = manifest.label || "Luau";
			const actionLabel = mode === "update" ? "Update" : "Install";

			if (promptConfirm) {
				const shouldContinue = await confirm(
					label,
					`${actionLabel} ${label} language server?`,
				);
				if (!shouldContinue) {
					return false;
				}
			}

			const downloadUrl = `https://github.com/${repo}/releases/latest/download/$ASSET`;
			const command = `apk add --no-cache curl unzip && ARCH="$(uname -m)" && case "$ARCH" in
${assetCases}
\t*) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
esac && apk add --no-cache gcompat libstdc++ && TMP_DIR="$(mktemp -d)" && cleanup() { rm -rf "$TMP_DIR"; } && trap cleanup EXIT && curl -fsSL "${downloadUrl}" -o "$TMP_DIR/$ASSET" && unzip -oq "$TMP_DIR/$ASSET" -d "$TMP_DIR" && chmod +x "$TMP_DIR/luau-lsp" && if ! "$TMP_DIR/luau-lsp" --help >/dev/null 2>&1 && ! "$TMP_DIR/luau-lsp" lsp --help >/dev/null 2>&1; then command -v ldd >/dev/null 2>&1 && ldd "$TMP_DIR/luau-lsp" >&2 || true; echo "Luau release binary is not runnable in this environment." >&2; exit 1; fi && install -Dm755 "$TMP_DIR/luau-lsp" ${quoteArg(binaryPath)}`;

			const loadingDialog = loader.create(
				label,
				`${actionLabel}ing ${label}...`,
			);
			try {
				loadingDialog.show();
				await runForegroundCommand(command);
				const runtimeFailure = await readLuauRuntimeFailure(binaryPath);
				if (runtimeFailure) {
					await runQuickCommand(`rm -f ${quoteArg(binaryPath)}`);
					throw new Error(getLuauRuntimeFailureMessage(runtimeFailure));
				}
				toast(`${label} ${mode === "update" ? "updated" : "installed"}`);
				return true;
			} catch (error) {
				console.error(`Failed to ${actionLabel.toLowerCase()} ${label}`, error);
				toast(strings?.error ?? "Error");
				throw error;
			} finally {
				loadingDialog.destroy();
			}
		},
	},
});
