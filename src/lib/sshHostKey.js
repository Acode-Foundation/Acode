import alert from "dialogs/alert";
import confirm from "dialogs/confirm";

/**
 * Handles structured host-key failures returned by the native SSH client.
 * @param {unknown} error
 * @returns {Promise<boolean>} true when the host was trusted and the caller should retry
 */
export async function resolveHostKeyError(error) {
	const details = parseHostKeyError(error);
	if (!details) return false;

	if (details.code === "HOST_KEY_CHANGED") {
		alert(
			strings["ssh host key changed"] || "SSH Host Key Changed",
			[
				`The identity of ${details.host} has changed.`,
				`Expected: ${details.expectedFingerprint || "unknown"}`,
				`Received: ${details.fingerprint}`,
				"The connection was blocked. Verify the server before changing its trusted key.",
			].join("\n\n"),
		);
		throw nonRetryableError(
			`SSH host key changed for ${details.host}`,
			details.code,
			true,
		);
	}

	if (details.code !== "HOST_KEY_UNKNOWN") return false;

	const trusted = await confirm(
		strings["unknown ssh host"] || "Unknown SSH Host",
		[
			`This is the first connection to ${details.host}.`,
			`Key type: ${details.algorithm}`,
			`Fingerprint: ${details.fingerprint}`,
			"Trust this host and continue?",
		].join("\n\n"),
	);
	if (!trusted) {
		throw nonRetryableError(
			`SSH host ${details.host} was not trusted`,
			details.code,
		);
	}

	await new Promise((resolve, reject) => {
		sftp.trustHost(
			details.host,
			details.algorithm,
			details.fingerprint,
			details.publicKey,
			resolve,
			reject,
		);
	});
	return true;
}

function parseHostKeyError(error) {
	let value = error?.error ?? error;
	if (typeof value === "string") {
		try {
			value = JSON.parse(value);
		} catch {
			return null;
		}
	}
	if (
		value &&
		typeof value === "object" &&
		["HOST_KEY_UNKNOWN", "HOST_KEY_CHANGED"].includes(value.code)
	) {
		return value;
	}
	return null;
}

function nonRetryableError(message, code, reported = false) {
	const error = new Error(message);
	error.code = code;
	error.nonRetryable = true;
	error.reported = reported;
	return error;
}
