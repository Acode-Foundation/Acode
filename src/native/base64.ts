export default { fromArrayBuffer, toArrayBuffer };

export function fromArrayBuffer(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	const chunks: string[] = [];
	for (let offset = 0; offset < bytes.length; offset += 32768) {
		chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)));
	}
	return btoa(chunks.join(""));
}

export function toArrayBuffer(encoded: string): ArrayBuffer {
	const decoded = atob(encoded);
	return Uint8Array.from(decoded, (char) => char.charCodeAt(0)).buffer;
}
