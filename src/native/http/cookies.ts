import {
	Cookie,
	CookieJar,
	MemoryCookieStore,
	type SerializedCookie,
	type SetCookieOptions,
} from "tough-cookie";

type StoredCookies = Record<
	string,
	Record<string, Record<string, SerializedCookie>>
>;
const storageKey = "__advancedHttpCookieStore__";

export default {
	setCookie,
	setCookieFromString,
	getCookieString,
	clearCookies,
	removeCookies,
};

function readJar() {
	const store = new MemoryCookieStore();
	let saved: StoredCookies = {};
	try {
		saved = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
	} catch {
		/* A malformed cache is treated as empty. */
	}
	for (const paths of Object.values(saved))
		for (const values of Object.values(paths))
			for (const value of Object.values(values)) {
				const cookie = Cookie.fromJSON(value);
				if (cookie) store.putCookie(cookie, () => {});
			}
	return new CookieJar(store, {
		allowSecureOnLocal: false,
		prefixSecurity: "unsafe-disabled",
		allowSpecialUseDomain: true,
	});
}
function persist(jar: CookieJar) {
	const saved: StoredCookies = Object.create(null);
	for (const cookie of jar.serializeSync()?.cookies ?? []) {
		const domain = String(cookie.domain);
		const path = String(cookie.path);
		const key = String(cookie.key);
		((saved[domain] ??= Object.create(null))[path] ??= Object.create(null))[
			key
		] = cookie;
	}
	localStorage.setItem(storageKey, JSON.stringify(saved));
}
function setCookie(
	url: string,
	cookie: string | Cookie,
	options: SetCookieOptions = {},
) {
	const jar = readJar();
	jar.setCookieSync(cookie, url, { ...options, ignoreError: false });
	persist(jar);
}
function setCookieFromString(
	url: string,
	header: string | string[] | null | undefined,
) {
	if (!header) return;
	const jar = readJar();
	const pieces = (Array.isArray(header) ? header.join(",") : header).split(",");
	const piecesIterator = pieces[Symbol.iterator]();
	for (let cookie of piecesIterator) {
		if (cookie.slice(-11, -3).toLowerCase() === "expires=")
			cookie += `,${piecesIterator.next().value}`;
		jar.setCookieSync(cookie.trim(), url, { ignoreError: true });
	}
	persist(jar);
}
function getCookieString(url: string) {
	return readJar().getCookieStringSync(url);
}
function clearCookies() {
	localStorage.removeItem(storageKey);
}
function removeCookies(
	url: string,
	callback: (error: Error | null, cookies?: never[]) => void,
) {
	const jar = readJar();
	const cookies = jar.getCookiesSync(url);
	if (!cookies.length) {
		callback(null, []);
		return;
	}
	jar.store.removeCookies(cookies[0].domain!, null, (error) => {
		if (!error) persist(jar);
		callback(error ?? null);
	});
}
