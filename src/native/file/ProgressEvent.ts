// Adapted file APIs; Apache-2.0. See licenses/file-LICENSE and file-NOTICE.
export default class FileProgressEvent<T = unknown> {
	bubbles = false;
	cancelBubble = false;
	cancelable = false;
	lengthComputable = false;
	loaded = 0;
	total = 0;
	target: T | null = null;
	constructor(
		public type: string,
		values: Partial<FileProgressEvent<T>> = {},
	) {
		Object.assign(this, values);
	}
}
export type FileHandler<T> =
	| ((this: T, event: FileProgressEvent<T>) => void)
	| null;
