import type { DirectoryEntry } from "../protocol";
import FileRoots from "./fileRoots";
import { baseName, joinPath, parentOf, trimSlash } from "./paths";
import TaskQueue from "./taskQueue";

export interface FileSystemHost {
	readDirectory(url: string): Promise<DirectoryEntry[]>;
	readFile(url: string): Promise<string>;
}

interface DirectoryNode {
	url: string;
	children?: Map<string, DirectoryEntry>;
	loading?: Promise<Map<string, DirectoryEntry> | undefined>;
	failed?: boolean;
}

interface FileNode {
	version: number;
	text?: string;
	loading?: Promise<string | undefined>;
	failed?: boolean;
}

const CONCURRENCY = 4;
const MAX_RELOAD_DEPTH = 8;
const CHANGE_DELAY = 150;

/**
 * Synchronous view of project folders for the TypeScript compiler. Unknown
 * entries read as missing and are fetched from the host in the background;
 * `onChange` fires once they arrive so the program can be rebuilt.
 */
export default class ProjectFileSystem {
	#host: FileSystemHost;
	#onChange: () => void;
	#roots = new FileRoots();
	#queue = new TaskQueue(CONCURRENCY);
	#directories = new Map<string, DirectoryNode>();
	#files = new Map<string, FileNode>();
	#paths = new Map<string, string>();
	#version = 0;
	#timer: ReturnType<typeof setTimeout> | undefined;

	constructor(host: FileSystemHost, onChange: () => void) {
		this.#host = host;
		this.#onChange = onChange;
	}

	get version(): number {
		return this.#version;
	}

	get busy(): boolean {
		return this.#queue.busy;
	}

	addRoot(path: string, url: string): void {
		this.#roots.add(path, url);
		this.#directories.set(path, this.#directories.get(path) ?? { url });
		this.#paths.set(trimSlash(url), path);
	}

	removeRoot(path: string): void {
		this.#roots.delete(path);
		const roots = this.#roots.paths();
		// Nested file roots share real paths; keep what another root still uses.
		const inside = (key: string) =>
			(key === path || key.startsWith(`${path}/`)) &&
			!roots.some((root) => key === root || key.startsWith(`${root}/`));
		for (const key of this.#directories.keys()) {
			if (inside(key)) this.#directories.delete(key);
		}
		for (const key of this.#files.keys()) {
			if (inside(key)) this.#files.delete(key);
		}
		for (const [url, key] of this.#paths) {
			if (inside(key)) this.#paths.delete(url);
		}
		this.#changed();
	}

	pathOf(url: string): string | undefined {
		const key = trimSlash(url);
		return this.#paths.get(key) ?? this.#roots.pathOf(key);
	}

	urlOf(path: string): string | undefined {
		const parent = this.#directories.get(parentOf(path));
		return (
			this.#directories.get(path)?.url ??
			parent?.children?.get(baseName(path))?.url ??
			(this.#roots.contains(path) ? this.#roots.urlOf(path) : undefined)
		);
	}

	directoryExists(path: string): boolean {
		const target = trimSlash(path);
		return (
			target === "/" ||
			this.#directories.has(target) ||
			!!this.#entry(target)?.isDirectory
		);
	}

	fileExists(path: string): boolean {
		const entry = this.#entry(path);
		return !!entry && !entry.isDirectory;
	}

	readFile(path: string): string | undefined {
		const node = this.#files.get(path);
		if (node?.text !== undefined || node?.loading || node?.failed) {
			return node.text;
		}
		const entry = this.#entry(path);
		if (entry && !entry.isDirectory) void this.#loadFile(path, entry.url);
		return undefined;
	}

	fileVersion(path: string): number {
		return this.#files.get(path)?.version ?? 0;
	}

	getEntries(path: string): { files: string[]; directories: string[] } {
		return splitEntries(this.#children(trimSlash(path)));
	}

	/** Entries already listed, without fetching more; keeps scans in budget. */
	listedEntries(path: string): { files: string[]; directories: string[] } {
		return splitEntries(this.#directories.get(trimSlash(path))?.children);
	}

	/**
	 * Drop cached content so the next read comes from the host again. The
	 * version keeps rising so text derived from the old content is never
	 * mistaken for the new one.
	 */
	invalidate(path: string): void {
		const node = this.#files.get(path);
		if (!node) return;
		node.text = undefined;
		node.failed = undefined;
		node.version++;
		this.#changed();
	}

	/**
	 * Map a URL that listings have not reported yet, such as a newly created
	 * file: re-list the nearest known folder and walk down from there. Paths
	 * always come from provider listings, so opaque URIs map correctly.
	 */
	async locate(url: string, root?: string): Promise<string | undefined> {
		const key = trimSlash(url);
		const known = this.pathOf(key);
		if (known) {
			await this.list(parentOf(known));
			if (!this.#listedEntry(known)) await this.#reload(parentOf(known));
			return known;
		}
		let directory = this.#ancestorOf(key) ?? root;
		while (directory) {
			await this.#reload(directory);
			const path = this.pathOf(key);
			if (path) return path;
			const deeper = this.#ancestorOf(key);
			if (!deeper || deeper === directory) return undefined;
			directory = deeper;
		}
		return undefined;
	}

	async list(path: string): Promise<Map<string, DirectoryEntry> | undefined> {
		const node = this.#directory(path);
		if (!node || node.failed) return undefined;
		return node.children ?? node.loading ?? this.#loadDirectory(path, node);
	}

	async read(path: string): Promise<string | undefined> {
		const entry = (await this.list(parentOf(path)))?.get(baseName(path));
		if (!entry || entry.isDirectory) return undefined;
		const node = this.#files.get(path);
		if (node?.text !== undefined) return node.text;
		return node?.loading ?? this.#loadFile(path, entry.url);
	}

	#entry(path: string): DirectoryEntry | undefined {
		return this.#children(parentOf(path))?.get(baseName(path));
	}

	#listedEntry(path: string): DirectoryEntry | undefined {
		return this.#directories.get(parentOf(path))?.children?.get(baseName(path));
	}

	#children(path: string): Map<string, DirectoryEntry> | undefined {
		const node = this.#directory(path);
		if (!node || node.failed) return undefined;
		if (!node.children && !node.loading) void this.#loadDirectory(path, node);
		return node.children;
	}

	#directory(path: string): DirectoryNode | undefined {
		const known = this.#directories.get(path);
		if (known) return known;
		// Parents of a file root exist even when their own parent is unreadable,
		// so shared configs and hoisted node_modules above the root resolve.
		const url = this.#roots.isAbove(path)
			? this.#roots.urlOf(path)
			: this.#listedDirectoryUrl(path);
		if (!url) return undefined;
		const node: DirectoryNode = { url };
		this.#directories.set(path, node);
		return node;
	}

	#listedDirectoryUrl(path: string): string | undefined {
		if (path === "/") return undefined;
		const entry = this.#entry(path);
		return entry?.isDirectory ? entry.url : undefined;
	}

	async #reload(path: string, depth = 0): Promise<boolean> {
		let node = this.#directory(path);
		if (!node && path !== "/" && depth < MAX_RELOAD_DEPTH) {
			if (!(await this.#reload(parentOf(path), depth + 1))) return false;
			node = this.#directory(path);
		}
		if (!node) return false;
		if (node.loading) await node.loading;
		node.failed = undefined;
		await this.#loadDirectory(path, node);
		return !node.failed;
	}

	#ancestorOf(url: string): string | undefined {
		let current = url;
		for (let index = current.lastIndexOf("/"); index > 0; ) {
			current = current.slice(0, index);
			const path = this.pathOf(current);
			if (path) return path;
			index = current.lastIndexOf("/");
		}
		return undefined;
	}

	#loadDirectory(
		path: string,
		node: DirectoryNode,
	): Promise<Map<string, DirectoryEntry> | undefined> {
		node.loading = this.#queue.run(async () => {
			try {
				const children = new Map<string, DirectoryEntry>();
				for (const entry of await this.#host.readDirectory(node.url)) {
					children.set(entry.name, entry);
					this.#paths.set(trimSlash(entry.url), joinPath(path, entry.name));
				}
				node.children = children;
			} catch {
				node.failed = true;
			}
			node.loading = undefined;
			this.#changed();
			return node.children;
		});
		return node.loading;
	}

	#loadFile(path: string, url: string): Promise<string | undefined> {
		const node: FileNode = this.#files.get(path) ?? { version: 0 };
		this.#files.set(path, node);
		node.loading = this.#queue.run(async () => {
			try {
				node.text = await this.#host.readFile(url);
				node.version++;
			} catch {
				node.failed = true;
			}
			node.loading = undefined;
			this.#changed();
			return node.text;
		});
		return node.loading;
	}

	#changed(): void {
		this.#version++;
		if (this.#timer) clearTimeout(this.#timer);
		this.#timer = setTimeout(() => {
			this.#timer = undefined;
			this.#onChange();
		}, CHANGE_DELAY);
	}
}

function splitEntries(children: Map<string, DirectoryEntry> | undefined) {
	const files: string[] = [];
	const directories: string[] = [];
	for (const entry of children?.values() ?? []) {
		(entry.isDirectory ? directories : files).push(entry.name);
	}
	return { files, directories };
}
