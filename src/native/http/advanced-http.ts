import { fromArrayBuffer, toArrayBuffer } from "../base64";
import exec from "../exec";
import { createEntry, type EntryData, FileSystem } from "../file/entries";
import cookies from "./cookies";
import errorCodes from "./error-codes";
import { encodeFormData, NativeFormData, ponyfills } from "./formData";
import messages from "./messages";
import type {
	ClientAuthOptions,
	Failure,
	Headers,
	Params,
	RequestOptions,
	Response,
	Serializer,
	Success,
} from "./types";
import urlUtil from "./url-util";
import * as validate from "./validation";

const serializers = ["urlencoded", "json", "utf8", "raw", "multipart"] as const;
const methods = [
	"get",
	"put",
	"post",
	"patch",
	"head",
	"delete",
	"options",
	"upload",
	"download",
] as const;
const responseTypes = ["text", "json", "arraybuffer", "blob"] as const;
const configuredHeaders: Record<string, Headers> = {};
const defaults = {
	serializer: "urlencoded" as Serializer,
	followRedirect: true,
	timeout: 60,
	connectTimeout: 60,
	readTimeout: 60,
};
let requestId = 0;

export default {
	getBasicAuthHeader: (username: string, password: string) => ({
		Authorization: `Basic ${encodeCredentials(username, password)}`,
	}),
	useBasicAuth: (username: string, password: string) =>
		setHeader(
			"*",
			"Authorization",
			`Basic ${encodeCredentials(username, password)}`,
		),
	getHeaders: (host = "*") => configuredHeaders[host] ?? null,
	setHeader,
	getDataSerializer: () => defaults.serializer,
	setDataSerializer: (value: Serializer) => {
		defaults.serializer = validate.choice(
			value,
			serializers,
			messages.INVALID_DATA_SERIALIZER,
		);
	},
	...cookies,
	getRequestTimeout: () => defaults.timeout,
	setRequestTimeout: (value: number) => {
		defaults.timeout =
			defaults.connectTimeout =
			defaults.readTimeout =
				validate.timeout(value);
	},
	getConnectTimeout: () => defaults.connectTimeout,
	setConnectTimeout: (value: number) => {
		defaults.connectTimeout = validate.timeout(value);
	},
	getReadTimeout: () => defaults.readTimeout,
	setReadTimeout: (value: number) => {
		defaults.readTimeout = validate.timeout(value);
	},
	getFollowRedirect: () => defaults.followRedirect,
	setFollowRedirect: (value: boolean) => {
		defaults.followRedirect = validate.redirect(value);
	},
	setServerTrustMode(mode: string, success: Success, failure: Failure) {
		checkCallbacks(success, failure);
		exec(success, failure, "NativeHttpPlugin", "setServerTrustMode", [
			validate.choice(
				mode,
				["default", "nocheck", "pinned", "legacy"],
				messages.INVALID_SSL_CERT_MODE,
			),
		]);
	},
	setClientAuthMode,
	sendRequest,
	post: (
		url: string,
		data: unknown,
		headers: Headers,
		success: Success,
		failure: Failure,
	) => sendRequest(url, { method: "post", data, headers }, success, failure),
	put: (
		url: string,
		data: unknown,
		headers: Headers,
		success: Success,
		failure: Failure,
	) => sendRequest(url, { method: "put", data, headers }, success, failure),
	patch: (
		url: string,
		data: unknown,
		headers: Headers,
		success: Success,
		failure: Failure,
	) => sendRequest(url, { method: "patch", data, headers }, success, failure),
	get: (
		url: string,
		params: Params,
		headers: Headers,
		success: Success,
		failure: Failure,
	) => sendRequest(url, { method: "get", params, headers }, success, failure),
	delete: (
		url: string,
		params: Params,
		headers: Headers,
		success: Success,
		failure: Failure,
	) =>
		sendRequest(url, { method: "delete", params, headers }, success, failure),
	head: (
		url: string,
		params: Params,
		headers: Headers,
		success: Success,
		failure: Failure,
	) => sendRequest(url, { method: "head", params, headers }, success, failure),
	options: (
		url: string,
		params: Params,
		headers: Headers,
		success: Success,
		failure: Failure,
	) =>
		sendRequest(url, { method: "options", params, headers }, success, failure),
	uploadFile: (
		url: string,
		params: Params,
		headers: Headers,
		filePath: string | string[],
		name: string | string[],
		success: Success,
		failure: Failure,
	) =>
		sendRequest(
			url,
			{ method: "upload", params, headers, filePath, name },
			success,
			failure,
		),
	downloadFile: (
		url: string,
		params: Params,
		headers: Headers,
		filePath: string,
		success: Success,
		failure: Failure,
	) =>
		sendRequest(
			url,
			{ method: "download", params, headers, filePath },
			success,
			failure,
		),
	abort: (id: number, success: Success, failure: Failure) =>
		exec(success, failure, "NativeHttpPlugin", "abort", [id]),
	ErrorCode: errorCodes,
	ponyfills,
};

function setHeader(
	hostOrName: string,
	nameOrValue: string | null,
	value?: string | null,
) {
	const host = arguments.length === 3 ? hostOrName : "*";
	const name = arguments.length === 3 ? nameOrValue! : hostOrName;
	const headerValue = arguments.length === 3 ? value : nameOrValue;
	if (name.toLowerCase() === "cookie")
		throw new Error(messages.ADDING_COOKIES_NOT_SUPPORTED);
	if (typeof headerValue !== "string" && headerValue !== null)
		throw new Error(messages.INVALID_HEADER_VALUE);
	const headers = (configuredHeaders[host] ??= {});
	if (headerValue === null) delete headers[name];
	else headers[name] = headerValue;
}
function sendRequest(
	url: string,
	options: RequestOptions | null,
	success: Success,
	failure: Failure,
) {
	checkCallbacks(success, failure);
	options ??= {};
	const method = validate.choice(
		options.method ?? "get",
		methods,
		messages.INVALID_HTTP_METHOD,
	);
	const serializer = validate.choice(
		options.serializer ?? defaults.serializer,
		serializers,
		messages.INVALID_DATA_SERIALIZER,
	);
	const responseType = validate.choice(
		options.responseType ?? "text",
		responseTypes,
		messages.INVALID_RESPONSE_TYPE,
	);
	url = urlUtil.appendQueryParamsString(
		url,
		urlUtil.serializeQueryParams(validate.params(options.params ?? {})),
	);
	const host = /^https?:\/\/([^/?#]+)/i.exec(url)?.[1] ?? "";
	const headers = {
		...configuredHeaders["*"],
		...configuredHeaders[host],
		...validate.headers(options.headers ?? {}),
	};
	const cookie = cookies.getCookieString(url);
	if (cookie) headers.Cookie = cookie;
	const connectTimeout = validate.timeout(
		options.connectTimeout ?? defaults.connectTimeout,
	);
	const readTimeout = validate.timeout(
		options.readTimeout ?? defaults.readTimeout,
	);
	const follow = validate.redirect(
		options.followRedirect ?? defaults.followRedirect,
	);
	const id = ++requestId;
	const onFailure = (response: Response) => {
		receiveCookies(url, response);
		failure(response);
	};
	const onSuccess = (response: Response) => {
		receiveCookies(url, response);
		try {
			if (method === "download") {
				const raw = response.file as EntryData;
				const entry = createEntry(
					raw,
					new FileSystem(
						raw.filesystemName ||
							(raw.filesystem === 1 ? "persistent" : "temporary"),
					),
				);
				response.file = response.data = entry;
				success(entry, response);
				return;
			}
			if (
				!(response.data instanceof ArrayBuffer) &&
				!(response.data instanceof Blob)
			) {
				const raw = response.data as string;
				if (responseType === "json")
					response.data = raw === "" ? undefined : JSON.parse(raw);
				else if (responseType === "arraybuffer")
					response.data = raw === "" ? null : toArrayBuffer(raw);
				else if (responseType === "blob")
					response.data =
						raw === ""
							? null
							: new Blob([toArrayBuffer(raw)], {
									type: response.headers["content-type"] ?? "",
								});
			}
			success(response);
		} catch (error) {
			failure({
				status: errorCodes.POST_PROCESSING_FAILED,
				error: `${messages.POST_PROCESSING_FAILED} ${error instanceof Error ? error.message : error}`,
				url: response.url,
				headers: response.headers,
			});
		}
	};
	const call = (action: string, args: unknown[]) =>
		exec(onSuccess, onFailure, "NativeHttpPlugin", action, args);
	if (["post", "put", "patch"].includes(method)) {
		const send = (data: unknown) =>
			call(method, [
				url,
				data,
				serializer,
				headers,
				connectTimeout,
				readTimeout,
				follow,
				responseType,
				id,
			]);
		const data = options.data ?? null;
		if (serializer === "multipart") {
			if (!(data instanceof FormData) && !(data instanceof NativeFormData))
				throw new Error(`${messages.INSTANCE_TYPE_MISMATCH_DATA} FormData`);
			void encodeFormData(data).then(send, (error) =>
				failure({
					status: errorCodes.GENERIC,
					error: String(error),
					url,
					headers: {},
				}),
			);
		} else {
			const type = Object.prototype.toString.call(data).slice(8, -1);
			const allowed = {
				utf8: ["String"],
				raw: ["Uint8Array", "ArrayBuffer"],
				json: ["Array", "Object"],
				urlencoded: ["Object"],
			}[serializer];
			if (!allowed.includes(type))
				throw new Error(`${messages.TYPE_MISMATCH_DATA} ${allowed.join(", ")}`);
			send(
				serializer === "utf8"
					? { text: data }
					: data instanceof Uint8Array
						? data.buffer
						: data,
			);
		}
	} else if (method === "upload") {
		const files = validate.strings(
			options.filePath,
			messages.TYPE_MISMATCH_FILE_PATHS,
			messages.EMPTY_FILE_PATHS,
		);
		const names = validate.strings(
			options.name,
			messages.TYPE_MISMATCH_NAMES,
			messages.EMPTY_NAMES,
		);
		call("uploadFiles", [
			url,
			headers,
			files,
			names,
			connectTimeout,
			readTimeout,
			follow,
			responseType,
			id,
		]);
	} else if (method === "download") {
		if (!options.filePath || typeof options.filePath !== "string")
			throw new Error(messages.INVALID_DOWNLOAD_FILE_PATH);
		call("downloadFile", [
			url,
			headers,
			options.filePath,
			connectTimeout,
			readTimeout,
			follow,
			id,
		]);
	} else
		call(method, [
			url,
			headers,
			connectTimeout,
			readTimeout,
			follow,
			responseType,
			id,
		]);
	return id;
}
function checkCallbacks(success: Success, failure: Failure) {
	if (typeof success !== "function")
		throw new Error(messages.MANDATORY_SUCCESS);
	if (typeof failure !== "function") throw new Error(messages.MANDATORY_FAIL);
}
function receiveCookies(url: string, response: Response) {
	const key = Object.keys(response.headers ?? {}).find(
		(key) => key.toLowerCase() === "set-cookie",
	);
	if (key) cookies.setCookieFromString(url, response.headers[key]);
}
function encodeCredentials(username: string, password: string) {
	return fromArrayBuffer(
		new TextEncoder().encode(`${username}:${password}`).buffer,
	);
}
function setClientAuthMode(
	mode: string,
	optionsOrSuccess: ClientAuthOptions | Success,
	successOrFailure: Success | Failure,
	optionalFailure?: Failure,
) {
	mode = validate.choice(
		mode,
		["none", "systemstore", "buffer"],
		messages.INVALID_CLIENT_AUTH_MODE,
	);
	const options =
		typeof optionsOrSuccess === "function" ? {} : (optionsOrSuccess ?? {});
	const success = (
		typeof optionsOrSuccess === "function" ? optionsOrSuccess : successOrFailure
	) as Success;
	const failure = (
		typeof optionsOrSuccess === "function" ? successOrFailure : optionalFailure
	) as Failure;
	checkCallbacks(success, failure);
	if (
		mode === "systemstore" &&
		options.alias !== undefined &&
		typeof options.alias !== "string"
	)
		throw new Error(messages.INVALID_CLIENT_AUTH_ALIAS);
	if (mode === "buffer" && !(options.rawPkcs instanceof ArrayBuffer))
		throw new Error(messages.INVALID_CLIENT_AUTH_RAW_PKCS);
	if (mode === "buffer" && typeof options.pkcsPassword !== "string")
		throw new Error(messages.INVALID_CLIENT_AUTH_PKCS_PASSWORD);
	exec(success, failure, "NativeHttpPlugin", "setClientAuthMode", [
		mode,
		mode === "systemstore" ? (options.alias ?? null) : null,
		mode === "buffer" ? options.rawPkcs : null,
		mode === "buffer" ? options.pkcsPassword : "",
	]);
}
