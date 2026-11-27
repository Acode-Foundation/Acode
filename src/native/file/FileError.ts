// Adapted file APIs; Apache-2.0. See licenses/file-LICENSE and file-NOTICE.
export default class FileError {
	static readonly NOT_FOUND_ERR = 1;
	static readonly SECURITY_ERR = 2;
	static readonly ABORT_ERR = 3;
	static readonly NOT_READABLE_ERR = 4;
	static readonly ENCODING_ERR = 5;
	static readonly NO_MODIFICATION_ALLOWED_ERR = 6;
	static readonly INVALID_STATE_ERR = 7;
	static readonly SYNTAX_ERR = 8;
	static readonly INVALID_MODIFICATION_ERR = 9;
	static readonly QUOTA_EXCEEDED_ERR = 10;
	static readonly TYPE_MISMATCH_ERR = 11;
	static readonly PATH_EXISTS_ERR = 12;
	constructor(public code: number) {}
}
