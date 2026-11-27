// Adapted file APIs; Apache-2.0. See licenses/file-LICENSE and file-NOTICE.
import exec from "../exec";
import NativeFile from "./File";
import FileError from "./FileError";
import FileReader from "./FileReader";
import FileProgressEvent, { type FileHandler } from "./ProgressEvent";

export default class FileWriter {
	static readonly INIT = 0;
	static readonly WRITING = 1;
	static readonly DONE = 2;
	fileName = "";
	localURL: string | null = null;
	length = 0;
	position = 0;
	readyState = 0;
	result = null;
	error: FileError | DOMException | null = null;
	onwritestart: FileHandler<FileWriter> = null;
	onprogress: FileHandler<FileWriter> = null;
	onwrite: FileHandler<FileWriter> = null;
	onwriteend: FileHandler<FileWriter> = null;
	onabort: FileHandler<FileWriter> = null;
	onerror: FileHandler<FileWriter> = null;
	constructor(file?: NativeFile | string) {
		if (typeof file === "string") this.localURL = file;
		else if (file) {
			this.localURL = file.localURL;
			this.length = file.size;
		}
	}
	abort() {
		if (this.readyState !== FileWriter.WRITING)
			throw new FileError(FileError.INVALID_STATE_ERR);
		this.error = new FileError(FileError.ABORT_ERR);
		this.readyState = FileWriter.DONE;
		this.emit("abort");
		this.emit("writeend");
	}
	write(
		data: string | ArrayBuffer | Blob | NativeFile,
		pendingBlobRead = false,
	) {
		if (data instanceof NativeFile || data instanceof Blob) {
			const reader = new FileReader();
			reader.onload = () => this.write(reader.result as ArrayBuffer, true);
			reader.onerror = () => {
				this.readyState = FileWriter.DONE;
				this.error = reader.error;
				this.emit("error");
				this.emit("writeend");
			};
			this.readyState = FileWriter.WRITING;
			reader.readAsArrayBuffer(data);
			return;
		}
		if (this.readyState === FileWriter.WRITING && !pendingBlobRead)
			throw new FileError(FileError.INVALID_STATE_ERR);
		this.readyState = FileWriter.WRITING;
		this.emit("writestart");
		exec(
			(written: number) => {
				if (this.readyState === FileWriter.DONE) return;
				this.position += written;
				this.length = this.position;
				this.readyState = FileWriter.DONE;
				this.emit("write");
				this.emit("writeend");
			},
			(code) => this.fail(code),
			"File",
			"write",
			[this.localURL, data, this.position, data instanceof ArrayBuffer],
		);
	}
	seek(offset: number) {
		if (this.readyState === FileWriter.WRITING)
			throw new FileError(FileError.INVALID_STATE_ERR);
		if (!offset && offset !== 0) return;
		this.position =
			offset < 0
				? Math.max(offset + this.length, 0)
				: Math.min(offset, this.length);
	}
	truncate(size: number) {
		if (this.readyState === FileWriter.WRITING)
			throw new FileError(FileError.INVALID_STATE_ERR);
		this.readyState = FileWriter.WRITING;
		this.emit("writestart");
		exec(
			(length: number) => {
				if (this.readyState === FileWriter.DONE) return;
				this.length = length;
				this.position = Math.min(this.position, length);
				this.readyState = FileWriter.DONE;
				this.emit("write");
				this.emit("writeend");
			},
			(code) => this.fail(code),
			"File",
			"truncate",
			[this.localURL, size],
		);
	}
	private fail(code: number) {
		if (this.readyState === FileWriter.DONE) return;
		this.readyState = FileWriter.DONE;
		this.error = new FileError(code);
		this.emit("error");
		this.emit("writeend");
	}
	private emit(type: "writestart" | "write" | "writeend" | "abort" | "error") {
		this[`on${type}`]?.call(
			this,
			new FileProgressEvent(type, { target: this }),
		);
	}
}
