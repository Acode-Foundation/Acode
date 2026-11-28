import confirm from "dialogs/confirm";
import browser from "native/browser";
import helpers from "utils/helpers";

export default async function openTerminalLink(uri, isRemote = false) {
	if (globalThis.Bridge?.platformId === "ios" && !isRemote) {
		const local = localPreviewUrl(uri);
		if (local) {
			try {
				browser.open(local, false, {
					ephemeral: true,
					onError: (error) => helpers.error(error),
				});
			} catch (error) {
				helpers.error(error);
			}
			return;
		}
	}
	if (await confirm("Terminal", `Do you want to open ${uri} in browser?`)) {
		system.openInBrowser(uri);
	}
}

function localPreviewUrl(uri) {
	try {
		const url = new URL(uri);
		if (!["http:", "https:"].includes(url.protocol)) return null;
		const host = url.hostname.toLowerCase().replace(/\.$/, "");
		if (host === "0.0.0.0") url.hostname = "127.0.0.1";
		else if (host === "[::]") url.hostname = "[::1]";
		else if (
			host !== "localhost" &&
			host !== "[::1]" &&
			!/^127\.\d+\.\d+\.\d+$/.test(host)
		) {
			return null;
		}
		return url.href;
	} catch {
		return null;
	}
}
