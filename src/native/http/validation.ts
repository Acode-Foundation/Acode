import messages from "./messages";
import type { Headers, Params } from "./types";

export function choice<T extends string>(
	value: unknown,
	choices: readonly T[],
	message: string,
): T {
	const normalized =
		typeof value === "string" ? value.trim().toLowerCase() : "";
	if (!choices.includes(normalized as T))
		throw new Error(`${message} ${choices.join(", ")}`);
	return normalized as T;
}
export function timeout(value: number) {
	if (typeof value !== "number" || value < 0)
		throw new Error(messages.INVALID_TIMEOUT_VALUE);
	return value;
}
export function redirect(value: boolean) {
	if (typeof value !== "boolean")
		throw new Error(messages.INVALID_FOLLOW_REDIRECT_VALUE);
	return value;
}
export function headers(value: Headers) {
	return record(value, false, messages.TYPE_MISMATCH_HEADERS) as Headers;
}
export function params(value: Params) {
	return record(value, true, messages.TYPE_MISMATCH_PARAMS) as Params;
}
export function strings(
	value: string | string[] | undefined,
	message: string,
	emptyMessage: string,
) {
	const values = typeof value === "string" ? [value] : value;
	if (!Array.isArray(values) || values.some((item) => typeof item !== "string"))
		throw new Error(message);
	if (!values.length) throw new Error(emptyMessage);
	return values;
}
function record(value: Headers | Params, arrays: boolean, message: string) {
	if (
		!value ||
		Object.prototype.toString.call(value) !== "[object Object]" ||
		Object.values(value).some(
			(item) => typeof item !== "string" && !(arrays && Array.isArray(item)),
		)
	)
		throw new Error(message);
	return value;
}
