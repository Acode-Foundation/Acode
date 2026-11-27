export default { parseUrl, appendQueryParamsString, serializeQueryParams };
const jsUtil = {
	getTypeOf: (value: unknown) =>
		Object.prototype.toString.call(value).slice(8, -1),
};

function parseUrl(url: string) {
	const match = url.match(
		/^(https?\:)\/\/(([^:\/?#]*)(?:\:([0-9]+))?)([\/]{0,1}[^?#]*)(\?[^#]*|)(#.*|)$/,
	);
	return (
		match && {
			protocol: match[1],
			host: match[2],
			hostname: match[3],
			port: match[4] || "",
			pathname: match[5],
			search: match[6],
			hash: match[7],
		}
	);
}
function appendQueryParamsString(url: string, params: string) {
	if (!url.length || !params.length) {
		return url;
	}
	const parsed = parseUrl(url);
	if (!parsed) throw new TypeError("Invalid HTTP URL");
	return (
		parsed.protocol +
		"//" +
		parsed.host +
		parsed.pathname +
		(parsed.search.length ? parsed.search + "&" + params : "?" + params) +
		parsed.hash
	);
}
function serializeQueryParams(params: Record<string, unknown>, encode = true) {
	return serializeObject("", params, encode);
}
function serializeObject(
	parentKey: string,
	object: Record<string, any>,
	encode: boolean,
): string {
	const parts = [];
	for (const key of Object.keys(object)) {
		if (!object.hasOwnProperty(key)) {
			continue;
		}
		const identifier = parentKey.length ? parentKey + "[" + key + "]" : key;
		if (jsUtil.getTypeOf(object[key]) === "Array") {
			parts.push(serializeArray(identifier, object[key], encode));
			continue;
		} else if (jsUtil.getTypeOf(object[key]) === "Object") {
			parts.push(serializeObject(identifier, object[key], encode));
			continue;
		}
		parts.push(
			serializeIdentifier(parentKey, key, encode) +
				"=" +
				serializeValue(object[key], encode),
		);
	}
	return parts.join("&");
}
function serializeArray(
	parentKey: string,
	array: any[],
	encode: boolean,
): string {
	const parts = [];
	for (const item of array) {
		if (jsUtil.getTypeOf(item) === "Array") {
			parts.push(serializeArray(parentKey + "[]", item, encode));
			continue;
		} else if (jsUtil.getTypeOf(item) === "Object") {
			parts.push(serializeObject(parentKey + "[]", item, encode));
			continue;
		}
		parts.push(
			serializeIdentifier(parentKey, "", encode) +
				"=" +
				serializeValue(item, encode),
		);
	}
	return parts.join("&");
}
function serializeIdentifier(parentKey: string, key: string, encode: boolean) {
	if (!parentKey.length) {
		return encode ? encodeURIComponent(key) : key;
	}
	if (encode) {
		return encodeURIComponent(parentKey) + "[" + encodeURIComponent(key) + "]";
	} else {
		return parentKey + "[" + key + "]";
	}
}
function serializeValue(value: string | number | boolean, encode: boolean) {
	if (encode) {
		return encodeURIComponent(value);
	} else {
		return value;
	}
}
