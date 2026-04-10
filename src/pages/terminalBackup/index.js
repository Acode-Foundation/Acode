/**
 * Terminal backup page
 * @param {() => void} onclose
 */
export default function TerminalBackup(onclose) {
	import("./terminalBackup").then((res) => res.default(onclose));
}
