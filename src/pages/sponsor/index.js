/**
 * Sponsor page
 * @param {() => void} onclose
 */
export default function Sponsor(onclose) {
	import("./sponsor").then((res) => res.default(onclose));
}
