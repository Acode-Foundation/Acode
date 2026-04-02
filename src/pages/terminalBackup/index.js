/**
 * Sponsor page
 * @param {() => void} onclose
 */
export default function Sponsor(onclose) {
	import("./terminalBackup").then((res) => res.default(onclose));
}
