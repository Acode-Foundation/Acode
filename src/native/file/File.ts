// Adapted file APIs; Apache-2.0. See licenses/file-LICENSE and file-NOTICE.
export default class NativeFile {
	start = 0;
	end: number;
	lastModifiedDate: number | Date | null;
	constructor(
		public name = "",
		public localURL: string | null = null,
		public type: string | null = null,
		public lastModified: number | Date | null = null,
		public size = 0,
	) {
		this.end = size;
		this.lastModifiedDate = lastModified;
	}
	slice(start = 0, end = this.end - this.start): NativeFile {
		const size = this.end - this.start;
		const file = new NativeFile(
			this.name,
			this.localURL,
			this.type,
			this.lastModified,
			this.size,
		);
		file.start =
			this.start +
			(start < 0 ? Math.max(size + start, 0) : Math.min(size, start));
		file.end =
			this.start + (end < 0 ? Math.max(size + end, 0) : Math.min(size, end));
		return file;
	}
}
