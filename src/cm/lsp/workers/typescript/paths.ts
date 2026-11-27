export function joinPath(directory: string, name: string): string {
	return directory === "/" ? `/${name}` : `${directory}/${name}`;
}

export function parentOf(path: string): string {
	const index = path.lastIndexOf("/");
	return index <= 0 ? "/" : path.slice(0, index);
}

export function baseName(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1);
}

export function trimSlash(value: string): string {
	return value.length > 1 && value.endsWith("/") ? value.slice(0, -1) : value;
}
