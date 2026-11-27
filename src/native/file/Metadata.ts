// Adapted file APIs; Apache-2.0. See licenses/file-LICENSE and file-NOTICE.
export default class Metadata {
	modificationTime: Date | null;
	size: number;
	constructor(
		metadata: { modificationTime?: string | number | Date; size?: number } = {},
	) {
		this.modificationTime = metadata.modificationTime
			? new Date(metadata.modificationTime)
			: null;
		this.size = metadata.size || 0;
	}
}
