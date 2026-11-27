const FILE_URL = "file://";

/**
 * Workspace roots by virtual path. `file:` roots use their real path, so the
 * folders above them can be reached by URL; other providers' roots are opaque.
 */
export default class FileRoots {
	#roots = new Map<string, string>();

	add(path: string, url: string): void {
		this.#roots.set(path, url);
	}

	delete(path: string): void {
		this.#roots.delete(path);
	}

	paths(): string[] {
		return [...this.#roots.keys()];
	}

	/** Real path of a `file:` URL inside a file root; listings decode URLs. */
	pathOf(url: string): string | undefined {
		if (!url.startsWith(`${FILE_URL}/`)) return undefined;
		const path = url.slice(FILE_URL.length);
		return this.contains(path) ? path : undefined;
	}

	urlOf(path: string): string {
		return `${FILE_URL}${path}`;
	}

	contains(path: string): boolean {
		return this.#fileRoots().some(
			(root) => path === root || path.startsWith(`${root}/`),
		);
	}

	isAbove(path: string): boolean {
		const prefix = path === "/" ? "/" : `${path}/`;
		return this.#fileRoots().some((root) => root.startsWith(prefix));
	}

	#fileRoots(): string[] {
		return [...this.#roots]
			.filter(([, url]) => url.startsWith(FILE_URL))
			.map(([path]) => path);
	}
}
