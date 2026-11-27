// Adapted file APIs; Apache-2.0. See licenses/file-LICENSE and file-NOTICE.
export class Flags {
	constructor(
		public create = false,
		public exclusive = false,
	) {}
}
export class FileUploadOptions {
	constructor(
		public fileKey: string | null = null,
		public fileName: string | null = null,
		public mimeType: string | null = null,
		public params: Record<string, unknown> | null = null,
		public headers: Record<string, string> | null = null,
		public httpMethod: string | null = null,
	) {}
}
export class FileUploadResult {
	constructor(
		public bytesSent?: number,
		public responseCode?: number,
		public response?: string,
	) {}
}
