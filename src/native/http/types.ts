import type { Entry, EntryData } from "../file/entries";
export type Headers = Record<string, string>;
export type Params = Record<string, string | string[]>;
export type Serializer = "urlencoded" | "json" | "utf8" | "raw" | "multipart";
export type ResponseType = "text" | "json" | "arraybuffer" | "blob";
export type Method =
	| "get"
	| "post"
	| "put"
	| "patch"
	| "head"
	| "delete"
	| "options"
	| "upload"
	| "download";
export interface RequestOptions {
	method?: Method;
	data?: unknown;
	params?: Params;
	headers?: Headers;
	serializer?: Serializer;
	responseType?: ResponseType;
	filePath?: string | string[];
	name?: string | string[];
	followRedirect?: boolean;
	timeout?: number;
	connectTimeout?: number;
	readTimeout?: number;
}
export interface Response<T = unknown> {
	status: number;
	url: string;
	headers: Headers;
	data?: T;
	file?: EntryData | Entry;
	error?: string;
}
export type Success = (
	response: Response | Entry,
	downloadResponse?: Response,
) => void;
export type Failure = (response: Response) => void;
export interface ClientAuthOptions {
	alias?: string;
	rawPkcs?: ArrayBuffer;
	pkcsPassword?: string;
}
