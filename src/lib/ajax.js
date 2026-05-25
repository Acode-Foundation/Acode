const GET = "GET";
const POST = "POST";
const PATCH = "PATCH";
const PUT = "PUT";
const DELETE = "DELETE";
const PURGE = "PURGE";

let xhrs = [];

/**
 * @typedef {Object} AjaxOptions
 * @property {string} [contentType="application/json"] - Value of the `Content-Type` request header.
 * @property {XMLHttpRequestResponseType} [responseType="json"] - Expected response type. Falls back to `ajax.responseType` if set.
 * @property {"GET"|"POST"|"PUT"|"PATCH"|"DELETE"|"PURGE"} [method="GET"] - HTTP method to use for the request.
 * @property {(loaded: number, total: number) => void} [onprogress] - Called during upload/download progress with bytes loaded and total.
 * @property {(response: *) => void} [onsuccess] - Called when the request completes with a 2xx status.
 * @property {(response: XMLHttpRequest | *) => void} [onerror] - Called when the request fails or returns a non-2xx status.
 * @property {(event: ProgressEvent) => void} [onload] - Called when the request finishes loading (mirrors `xhr.onload`).
 * @property {(event: ProgressEvent) => void} [onloadend] - Called when the request completes, regardless of success or failure.
 * @property {(event: ProgressEvent) => void} [onabort] - Called if the request is aborted.
 * @property {(event: ProgressEvent) => void} [ontimeout] - Called if the request times out.
 * @property {(xhr: XMLHttpRequest) => void} [configure] - Per-request XHR configuration hook, called just before `xhr.send()`.
 * @property {string} [mimeType="text/xml"] - Overrides the MIME type returned by the server via `xhr.overrideMimeType()`.
 * @property {Object|*} [data] - Request payload. Serialized to JSON automatically when `contentType` is `"application/json"`.
 * @property {string} url - URL to send the request to.
 */

/**
 * Sends an HTTP request via `XMLHttpRequest` and returns a `Promise` that resolves
 * with the mapped response on success, or rejects with the XHR instance (or mapped
 * response) on failure.
 *
 * Global behaviour can be customised via {@link ajax.configure}, {@link ajax.response},
 * and {@link ajax.onprogress}.
 *
 * @param {AjaxOptions} [options={}] - Request configuration.
 * @returns {Promise<*>} Resolves with the value returned by {@link ajax.response},
 *   or rejects with the XHR instance / mapped error response.
 *
 * @example
 * // Basic JSON POST
 * const user = await ajax({
 *   url: "/api/users",
 *   method: "POST",
 *   data: { name: "Alice" },
 *   onsuccess: (res) => console.log("Created:", res),
 *   onerror:   (res) => console.error("Failed:", res),
 * });
 */
export default function ajax(options = {}) {
	const xhr = getHTTP();

	const {
		contentType = "application/json",
		responseType = ajax.responseType || "json",
		method = GET,
		onprogress = () => {},
		onsuccess = () => {},
		onerror = () => {},
		onload = () => {},
		onloadend = () => {},
		onabort = () => {},
		ontimeout = () => {},
		configure = () => {},
		mimeType = "text/xml",
		data,
		url,
	} = options;

	return new Promise((resolve, reject) => {
		let body;

		if (data && contentType === "application/json") {
			body = JSON.stringify(data);
		}

		xhr.addEventListener("load", onload);
		xhr.addEventListener("abort", onabort);
		xhr.addEventListener("loadend", onloadend);
		xhr.addEventListener("timeout", ontimeout);
		xhr.addEventListener("progress", progress);
		xhr.addEventListener("error", handleError);
		xhr.addEventListener("readystatechange", onreadystatechange);

		xhr.open(method, url, true);
		xhr.setRequestHeader("Content-Type", contentType);
		xhr.overrideMimeType(mimeType);
		ajax.configure(xhr, url);
		configure(xhr);
		xhr.send(body);

		function onreadystatechange() {
			const { readyState, status } = xhr;

			if (readyState === 2) {
				if (status >= 200 && status < 300) {
					xhr.responseType = responseType;
				} else {
					xhr.responseType = "text";
				}
			} else if (readyState === 4) {
				if (status >= 200 && status < 300) {
					const res = ajax.response(xhr);
					onsuccess(res);
					resolve(res);
				} else {
					handleError();
				}
			}
		}

		function progress(e) {
			const { loaded, total } = e;
			const percent = Math.round((loaded / total) * 100);
			xhr.percent = percent;

			if (typeof onprogress === "function") {
				onprogress(loaded, total);
			}

			if (typeof ajax.onprogress === "function") {
				const progresses = [];
				xhrs = xhrs.filter((xhr) => {
					if (xhr.status !== 200 || xhr.percent === 100) return false;
					progresses.push(xhr.percent);
					return true;
				});

				ajax.onprogress(Math.min(...progresses, 100));
			}
		}

		function handleError() {
			let res = xhr;

			if (responseType === "json") {
				let json;

				try {
					json = JSON.parse(xhr.responseText);
				} catch (error) {
					json = xhr.responseText;
				}

				Object.defineProperty(xhr, "response", {
					value: json,
				});
			}

			if (typeof ajax.response === "function") {
				res = ajax.response(xhr);
			}

			onerror(res);
			reject(res);
		}
	});

	/**
	 * @returns {XMLHttpRequest}
	 */
	function getHTTP() {
		const xhr = new XMLHttpRequest();
		xhrs.push(xhr);
		return xhr;
	}
}

/**
 * Global response mapper applied to every completed request (success **and** error).
 *
 * Override this to normalise or unwrap XHR responses application-wide.
 * The return value becomes the resolved/rejected value of the `ajax()` promise.
 *
 * @param {XMLHttpRequest} xhr - The completed XHR instance.
 * @returns {*} The value that the promise will resolve or reject with.
 *
 * @example
 * ajax.response = (xhr) => xhr.response?.data ?? xhr.response;
 */
ajax.response = (xhr) => {};

/**
 * Global XHR configuration hook called on every request, just before `xhr.send()`.
 *
 * Use this to attach auth headers, CSRF tokens, or any other cross-cutting concerns
 * without repeating them in every call site.
 *
 * @param {XMLHttpRequest} xhr - The XHR instance about to be sent.
 * @param {string} url
 *
 * @example
 * ajax.configure = (xhr) => {
 *   xhr.setRequestHeader("Authorization", `Bearer ${getToken()}`);
 *   xhr.timeout = 30_000;
 * };
 */
ajax.configure = (xhr, url) => {};

ajax.get = function (url, options = {}) {
	return ajax({
		url,
		method: GET,
		...options,
	});
};

ajax.post = function (url, options = {}) {
	return ajax({
		url,
		method: POST,
		...options,
	});
};

ajax.put = function (url, options = {}) {
	return ajax({
		url,
		method: PUT,
		...options,
	});
};

ajax.patch = function (url, options = {}) {
	return ajax({
		url,
		method: PATCH,
		...options,
	});
};

ajax.delete = function (url, options = {}) {
	return ajax({
		url,
		method: DELETE,
		...options,
	});
};

ajax.purge = function (url, options = {}) {
	return ajax({
		url,
		method: PURGE,
		...options,
	});
};
