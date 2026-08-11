/**
 * Quote one value for use as a literal argument in a POSIX shell command.
 * Control characters are rejected because terminal input is line-oriented.
 * @param {unknown} value
 * @returns {string}
 */
export function quotePosixShellArg(value) {
	const argument = String(value);
	if (/\0|\r|\n/.test(argument)) {
		throw new Error("Shell arguments cannot contain control characters");
	}
	return `'${argument.replaceAll("'", `'"'"'`)}'`;
}
