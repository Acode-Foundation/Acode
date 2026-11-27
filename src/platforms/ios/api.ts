import installAPIXHR from "./apiXHR";

const responseURLHeader = "X-Acode-Response-URL";

export default function installAPITransport() {
	const fetch = window.fetch;
	window.fetch = async (input, options) => {
		const url = input instanceof Request ? input.url : String(input);
		const target = localURL(url);
		if (!target) return fetch.call(window, input, options);
		const request = new Request(input, options);
		if (request.mode === "no-cors") return fetch.call(window, request);
		if (request.mode === "same-origin")
			throw new TypeError("Cross-origin request is not allowed");
		const headers = new Headers(request.headers);
		headers.set("X-Acode-API-Origin", new URL(request.url).origin);
		headers.set("X-Acode-Credentials", request.credentials);
		headers.set("X-Acode-Redirect", request.redirect);
		const response = await fetch.call(window, target, {
			method: request.method,
			headers,
			body: ["GET", "HEAD"].includes(request.method)
				? undefined
				: await request.arrayBuffer(),
			signal: request.signal,
			cache: request.cache,
			redirect: request.redirect,
			integrity: request.integrity,
		});
		const remoteURL = response.headers.get(responseURLHeader) || request.url;
		const requestedURL = new URL(request.url);
		requestedURL.hash = "";
		return withRemoteURL(response, remoteURL, remoteURL !== requestedURL.href);
	};
	installAPIXHR(localURL);
}

function withRemoteURL(
	response: Response,
	url: string,
	redirected: boolean,
): Response {
	const clone = response.clone.bind(response);
	Object.defineProperties(response, {
		url: { value: url },
		redirected: { value: redirected },
		clone: { value: () => withRemoteURL(clone(), url, redirected) },
	});
	return response;
}

function localURL(value: string) {
	try {
		const url = new URL(value, location.href);
		if (
			!["https://acode.app", "https://dev.acode.app"].includes(url.origin) ||
			url.username ||
			url.password ||
			!(url.pathname === "/api" || url.pathname.startsWith("/api/"))
		)
			return null;
		return `acode://localhost/__api__/${url.pathname.slice(5)}${url.search}`;
	} catch {
		return null;
	}
}
