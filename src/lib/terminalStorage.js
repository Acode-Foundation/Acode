import fsOperation from "fileSystem";
import { getTerminalPaths } from "./terminalPaths";

const ROOT_CONFIG = {
	home: {
		pathKey: "legacyHomeDir",
		label: "Legacy Home",
		destinationPrefix: "Recovered Home",
	},
	root: {
		pathKey: "legacyRootDir",
		label: "Legacy Root",
		destinationPrefix: "Recovered Root",
	},
};

function toFileUrl(path) {
	return path.startsWith("file://") ? path : `file://${path}`;
}

function toNativePath(url) {
	const path = String(url).replace(/^file:\/\//, "");
	try {
		return decodeURIComponent(path);
	} catch {
		return path;
	}
}

function quoteShell(value) {
	return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function errorMessage(error) {
	if (typeof error === "string") return error;
	return error?.message || String(error);
}

export function formatRecoveryTimestamp(date = new Date()) {
	const pad = (value) => String(value).padStart(2, "0");
	return (
		[date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join(
			"-",
		) +
		` ${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
	);
}

export function buildRecoveryFolderName(kind, date = new Date(), suffix = 0) {
	const root = ROOT_CONFIG[kind];
	if (!root) throw new Error(`Unknown legacy root: ${kind}`);
	const base = `${root.destinationPrefix} ${formatRecoveryTimestamp(date)}`;
	return suffix > 0 ? `${base} (${suffix + 1})` : base;
}

function defaultGetFilesDir() {
	return new Promise((resolve, reject) => {
		if (!globalThis.system?.getFilesDir) {
			reject(new Error("System plugin is not available"));
			return;
		}
		globalThis.system.getFilesDir(resolve, reject);
	});
}

export class TerminalStorageService {
	constructor({
		getFilesDir = defaultGetFilesDir,
		fsFactory = fsOperation,
		getExecutor = () => globalThis.Executor,
		getTerminal = () => globalThis.Terminal,
		now = () => new Date(),
	} = {}) {
		this.getFilesDir = getFilesDir;
		this.fsFactory = fsFactory;
		this.getExecutor = getExecutor;
		this.getTerminal = getTerminal;
		this.now = now;
	}

	async getStatus() {
		const filesDir = await this.getFilesDir();
		const paths = getTerminalPaths({ filesDir });
		const roots = {};

		for (const [kind, config] of Object.entries(ROOT_CONFIG)) {
			const path = paths[config.pathKey];
			const url = toFileUrl(path);
			let hasData = false;
			let error = null;
			try {
				const fs = this.fsFactory(url);
				hasData = (await fs.exists()) && (await fs.lsDir()).length > 0;
			} catch (failure) {
				error = errorMessage(failure);
			}
			roots[kind] = { kind, label: config.label, path, url, hasData, error };
		}

		return {
			filesDir,
			publicPath: paths.publicDir,
			publicUrl: toFileUrl(paths.publicDir),
			roots,
			hasLegacyData: Object.values(roots).some((root) => root.hasData),
		};
	}

	async createUniqueDestination(publicUrl, kind, timestamp) {
		for (let suffix = 0; suffix < 1000; suffix++) {
			const name = buildRecoveryFolderName(kind, timestamp, suffix);
			const candidate = `${publicUrl.replace(/\/$/, "")}/${name}`;
			if (!(await this.fsFactory(candidate).exists())) {
				const url = await this.fsFactory(publicUrl).createDirectory(name);
				return { name, url, path: toNativePath(url) };
			}
		}
		throw new Error(`Unable to allocate a recovery folder for ${kind}`);
	}

	async getInventory(path) {
		const executor = this.getExecutor();
		if (!executor?.execute) throw new Error("Executor plugin is not available");
		const quotedPath = quoteShell(path);
		const command =
			`cd ${quotedPath} && ` +
			"LC_ALL=C find . -mindepth 1 -exec stat -c '%F|%s|%n' {} ';' | " +
			"LC_ALL=C sort | sha256sum";
		const hash = String(await executor.execute(command))
			.trim()
			.split(/\s+/)[0];
		const countOutput = await executor.execute(
			`cd ${quotedPath} && find . -mindepth 1 -print | wc -l`,
		);
		return {
			hash,
			count: Number.parseInt(String(countOutput).trim(), 10) || 0,
		};
	}

	async stopTerminalProcesses() {
		const terminal = this.getTerminal();
		if (!terminal?.isAxsRunning) return false;
		if (!(await terminal.isAxsRunning())) return false;
		await terminal.stopAxs();
		return true;
	}

	async importCopies(status = null) {
		const currentStatus = status || (await this.getStatus());
		const result = {
			startedAt: this.now().toISOString(),
			destinations: { home: null, root: null },
			copied: 0,
			skipped: 0,
			verified: true,
			stoppedTerminal: false,
			manifestUrl: null,
			errors: [],
		};

		if (!currentStatus.hasLegacyData) return result;
		result.stoppedTerminal = await this.stopTerminalProcesses();
		const timestamp = this.now();
		const executor = this.getExecutor();
		if (!executor?.execute) throw new Error("Executor plugin is not available");

		for (const [kind, root] of Object.entries(currentStatus.roots)) {
			if (!root.hasData) continue;

			const destination = await this.createUniqueDestination(
				currentStatus.publicUrl,
				kind,
				timestamp,
			);
			const itemResult = {
				source: root.path,
				destination: destination.path,
				destinationUrl: destination.url,
				copied: 0,
				skipped: 0,
				verified: false,
				error: null,
			};
			result.destinations[kind] = itemResult;

			let sourceInventory = { hash: "", count: 0 };
			try {
				sourceInventory = await this.getInventory(root.path);
				await executor.execute(
					`cp -a ${quoteShell(root.path)}/. ${quoteShell(destination.path)}/`,
				);
				const destinationInventory = await this.getInventory(destination.path);
				itemResult.copied = destinationInventory.count;
				itemResult.skipped = Math.max(
					0,
					sourceInventory.count - destinationInventory.count,
				);
				itemResult.verified =
					sourceInventory.count === destinationInventory.count &&
					sourceInventory.hash === destinationInventory.hash;
				if (!itemResult.verified) {
					throw new Error("Copied inventory does not match the legacy source");
				}
			} catch (failure) {
				itemResult.error = errorMessage(failure);
				itemResult.skipped = Math.max(
					itemResult.skipped,
					sourceInventory.count - itemResult.copied,
				);
				result.errors.push({ kind, message: itemResult.error });
			}

			result.copied += itemResult.copied;
			result.skipped += itemResult.skipped;
			result.verified = result.verified && itemResult.verified;
		}

		const manifest = {
			version: 1,
			...result,
			completedAt: this.now().toISOString(),
		};
		const manifestName = `.acode-legacy-recovery-${formatRecoveryTimestamp(
			timestamp,
		).replace(/[ :]/g, "-")}.json`;
		try {
			result.manifestUrl = await this.fsFactory(
				currentStatus.publicUrl,
			).createFile(manifestName, JSON.stringify(manifest, null, 2));
		} catch (failure) {
			result.verified = false;
			result.errors.push({
				kind: "manifest",
				message: `Copied files, but could not write the recovery manifest: ${errorMessage(failure)}`,
			});
		}
		return result;
	}
}

export default new TerminalStorageService();
