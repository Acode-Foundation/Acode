export default function installAPIXHR(
	localURL: (url: string) => string | null,
) {
	const prototype = XMLHttpRequest.prototype;
	const { open, send, abort, setRequestHeader } = prototype;
	const requests = new WeakMap<
		XMLHttpRequest,
		{
			url: string;
			method: string;
			async: boolean;
			headers: Headers;
			pending: boolean;
			sent: boolean;
		}
	>();
	prototype.open = function (
		method: string,
		url: string | URL,
		async: boolean = true,
		user?: string | null,
		password?: string | null,
	) {
		const target = localURL(String(url));
		if (target)
			requests.set(this, {
				url: String(url),
				method: method.toUpperCase(),
				async,
				headers: new Headers(),
				pending: false,
				sent: false,
			});
		else requests.delete(this);
		try {
			open.call(this, method, target || url, async, user, password);
		} catch (error) {
			requests.delete(this);
			throw error;
		}
	};
	prototype.setRequestHeader = function (name, value) {
		setRequestHeader.call(this, name, value);
		requests.get(this)?.headers.append(name, value);
	};
	prototype.send = function (body) {
		const state = requests.get(this);
		if (!state) return send.call(this, body);
		if (state.sent)
			throw new DOMException("Request already sent", "InvalidStateError");
		const serialize =
			!["GET", "HEAD"].includes(state.method) &&
			(body instanceof Blob || body instanceof FormData);
		if (serialize && !state.async)
			throw new DOMException(
				"Binary API uploads require asynchronous XHR on iOS",
				"InvalidAccessError",
			);
		setRequestHeader.call(
			this,
			"X-Acode-API-Origin",
			new URL(state.url, location.href).origin,
		);
		setRequestHeader.call(
			this,
			"X-Acode-Credentials",
			this.withCredentials ? "include" : "omit",
		);
		if (!serialize) {
			send.call(this, body);
			state.sent = true;
			return;
		}
		const request = new Request(state.url, {
			method: state.method,
			headers: state.headers,
			body,
		});
		state.sent = state.pending = true;
		const contentType = request.headers.get("Content-Type");
		if (contentType && !state.headers.has("Content-Type"))
			setRequestHeader.call(this, "Content-Type", contentType);
		const timer = this.timeout
			? setTimeout(() => {
					if (requests.get(this) !== state || !state.pending) return;
					state.pending = false;
					abort.call(this);
					this.dispatchEvent(new ProgressEvent("timeout"));
					this.dispatchEvent(new ProgressEvent("loadend"));
				}, this.timeout)
			: undefined;
		void request
			.arrayBuffer()
			.then((bytes) => {
				clearTimeout(timer);
				if (requests.get(this) !== state || !state.pending) return;
				state.pending = false;
				try {
					send.call(this, bytes);
				} catch (error) {
					state.pending = true;
					throw error;
				}
			})
			.catch(() => {
				clearTimeout(timer);
				if (requests.get(this) !== state || !state.pending) return;
				state.pending = false;
				abort.call(this);
				this.dispatchEvent(new ProgressEvent("error"));
				this.dispatchEvent(new ProgressEvent("loadend"));
			});
	};
	prototype.abort = function () {
		const state = requests.get(this);
		const preparing = state?.pending;
		if (state) state.pending = false;
		abort.call(this);
		if (preparing) {
			this.dispatchEvent(new ProgressEvent("abort"));
			this.dispatchEvent(new ProgressEvent("loadend"));
		}
	};
	const responseURL = Object.getOwnPropertyDescriptor(prototype, "responseURL");
	if (responseURL?.get)
		Object.defineProperty(prototype, "responseURL", {
			...responseURL,
			get() {
				return requests.has(this) && this.readyState >= 2
					? this.getResponseHeader("X-Acode-Response-URL") ||
							requests.get(this)?.url
					: responseURL.get?.call(this);
			},
		});
}
