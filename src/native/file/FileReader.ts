// Adapted file APIs; Apache-2.0. See licenses/file-LICENSE and file-NOTICE.
import exec from "../exec";
import NativeFile from "./File";
import FileError from "./FileError";
import FileProgressEvent, { type FileHandler } from "./ProgressEvent";

const BrowserFileReader = window.FileReader;
type ReadMethod =
	| "readAsText"
	| "readAsDataURL"
	| "readAsBinaryString"
	| "readAsArrayBuffer";

export default class NativeFileReader {
	static readonly EMPTY = 0;
	static readonly LOADING = 1;
	static readonly DONE = 2;
	static READ_CHUNK_SIZE = 256 * 1024;
	private state = 0;
	private nativeURL = "";
	private value: string | ArrayBuffer | null = null;
	private failure: FileError | null = null;
	private browser = new BrowserFileReader();
	onloadstart: FileHandler<NativeFileReader> = null;
	onprogress: FileHandler<NativeFileReader> = null;
	onload: FileHandler<NativeFileReader> = null;
	onerror: FileHandler<NativeFileReader> = null;
	onloadend: FileHandler<NativeFileReader> = null;
	onabort: FileHandler<NativeFileReader> = null;
	get readyState() {
		return this.nativeURL ? this.state : this.browser.readyState;
	}
	get result() {
		return this.nativeURL ? this.value : this.browser.result;
	}
	get error() {
		return this.nativeURL ? this.failure : this.browser.error;
	}
	readAsText(file: NativeFile | Blob, encoding = "UTF-8") {
		this.read(file, "readAsText", encoding);
	}
	readAsDataURL(file: NativeFile | Blob) {
		this.read(file, "readAsDataURL");
	}
	readAsBinaryString(file: NativeFile | Blob) {
		this.read(file, "readAsBinaryString");
	}
	readAsArrayBuffer(file: NativeFile | Blob) {
		this.read(file, "readAsArrayBuffer");
	}
	abort() {
		if (!this.nativeURL) {
			this.browser.abort();
			return;
		}
		this.value = null;
		if (this.state !== NativeFileReader.LOADING) return;
		this.state = NativeFileReader.DONE;
		this.emit("abort");
		this.emit("loadend");
	}
	private emit(
		type: "loadstart" | "progress" | "load" | "error" | "loadend" | "abort",
		loaded = 0,
		total = 0,
	) {
		this[`on${type}`]?.call(
			this,
			new FileProgressEvent(type, { target: this, loaded, total }),
		);
	}
	private read(file: NativeFile | Blob, method: ReadMethod, encoding?: string) {
		if (this.readyState === NativeFileReader.LOADING)
			throw new FileError(FileError.INVALID_STATE_ERR);
		this.value = null;
		this.failure = null;
		this.state = NativeFileReader.LOADING;
		if (!("localURL" in file) || typeof file.localURL !== "string") {
			this.nativeURL = "";
			for (const event of [
				"loadstart",
				"progress",
				"load",
				"error",
				"loadend",
				"abort",
			] as const)
				this.browser[`on${event}`] = (e) => this.emit(event, e.loaded, e.total);
			if (method === "readAsText")
				this.browser.readAsText(file as Blob, encoding);
			else this.browser[method](file as Blob);
			return;
		}
		this.nativeURL = file.localURL;
		this.emit("loadstart");
		const size = file.end - file.start;
		const chunkSize =
			method === "readAsDataURL"
				? NativeFileReader.READ_CHUNK_SIZE -
					(NativeFileReader.READ_CHUNK_SIZE % 3) +
					3
				: NativeFileReader.READ_CHUNK_SIZE;
		// Decoding each chunk natively would split characters that cross a chunk
		// boundary, so text is read as bytes and decoded in one stream here.
		const decoder = method === "readAsText" ? textDecoder(encoding) : null;
		const nativeMethod = decoder ? "readAsArrayBuffer" : method;
		let progress = 0;
		const readChunk = () => {
			const end = progress + Math.min(size - progress, chunkSize);
			const args: unknown[] = [
				file.localURL,
				file.start + progress,
				file.start + end,
			];
			if (encoding && !decoder) args.splice(1, 0, encoding);
			exec(
				(data: string | ArrayBuffer) => {
					if (this.state === NativeFileReader.DONE) return;
					if (decoder) {
						const text = decoder.decode(new Uint8Array(data as ArrayBuffer), {
							stream: end < size,
						});
						this.value = `${this.value ?? ""}${text}`;
					} else if (method === "readAsArrayBuffer") {
						const bytes = this.value
							? new Uint8Array(this.value as ArrayBuffer)
							: new Uint8Array(size);
						bytes.set(new Uint8Array(data as ArrayBuffer), progress);
						this.value = bytes.buffer;
					} else if (method === "readAsDataURL")
						this.value =
							progress === 0
								? data
								: `${this.value}${(data as string).slice((data as string).indexOf(",") + 1)}`;
					else this.value = `${this.value ?? ""}${data}`;
					progress = Math.min(progress + chunkSize, size);
					this.emit("progress", progress, size);
					if (progress < size) readChunk();
					else {
						this.state = NativeFileReader.DONE;
						this.emit("load");
						this.emit("loadend");
					}
				},
				(code) => {
					if (this.state === NativeFileReader.DONE) return;
					this.state = NativeFileReader.DONE;
					this.value = null;
					this.failure = new FileError(Number(code));
					this.emit("error");
					this.emit("loadend");
				},
				"File",
				nativeMethod,
				args,
			);
		};
		readChunk();
	}
}

function textDecoder(encoding?: string) {
	try {
		return new TextDecoder(encoding || "utf-8");
	} catch {
		// Labels TextDecoder does not know keep the native per-chunk decoding.
		return null;
	}
}
