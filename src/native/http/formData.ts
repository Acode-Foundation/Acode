import { fromArrayBuffer } from "../base64";
import NativeFile from "../file/File";
import NativeFileReader from "../file/FileReader";

export class NativeFormData {
	private items: [string, string | Blob | NativeFile][] = [];
	append(name: string, value: unknown, filename?: string) {
		if (value instanceof Blob) {
			if (!("name" in value))
				Object.assign(value, {
					name: filename ?? "blob",
					lastModifiedDate: new Date(),
				});
		} else if (!(value instanceof NativeFile)) value = String(value);
		this.items.push([name, value as string | Blob | NativeFile]);
	}
	entries() {
		return this.items[Symbol.iterator]();
	}
}
export const ponyfills = { FormData: NativeFormData };
export async function encodeFormData(data: FormData | NativeFormData) {
	const result = {
		buffers: [] as string[],
		names: [] as string[],
		fileNames: [] as (string | null)[],
		types: [] as string[],
	};
	for (const [name, value] of data.entries()) {
		if (typeof value === "string") {
			result.buffers.push(
				fromArrayBuffer(new TextEncoder().encode(value).buffer),
			);
			result.names.push(name);
			result.fileNames.push(null);
			result.types.push("text/plain");
		} else if (value instanceof Blob || value instanceof NativeFile) {
			const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
				const reader = new NativeFileReader();
				reader.onload = () => resolve(reader.result as ArrayBuffer);
				reader.onerror = () => reject(reader.error);
				reader.readAsArrayBuffer(value);
			});
			result.buffers.push(fromArrayBuffer(bytes));
			result.names.push(name);
			result.fileNames.push("name" in value ? String(value.name) : "blob");
			result.types.push(value.type || "");
		}
	}
	return result;
}
