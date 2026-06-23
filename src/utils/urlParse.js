/**
 * @param {string} input
 * @returns {URL}
 */
function URLParse(input) {
	try {
		return new URL(input);
	} catch {
		// Does not throw on invalid input
		return {
			href: input,
			origin: "null",
			protocol: "",
			username: "",
			password: "",
			host: "",
			hostname: "",
			port: "",
			pathname: input,
			search: "",
			searchParams: new URLSearchParams(),
			hash: "",
			toJSON() {
				return input;
			},
		};
	}
}

export default URLParse;
