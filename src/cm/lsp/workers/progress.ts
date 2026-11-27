export interface WorkDoneProgress {
	report(message: string, percentage?: number): void;
	end(message?: string): void;
}

export interface ProgressChannel {
	/** Resolves once the client is initialized, with its progress support. */
	ready: Promise<boolean>;
	request(method: string, params: unknown): Promise<unknown>;
	notify(method: string, params: unknown): void;
}

let nextToken = 0;

/**
 * Standard LSP work-done progress: the token is created through the client
 * and every notification waits for the previous one, so begin, reports and
 * end always arrive in order.
 */
export default function createProgress(
	channel: ProgressChannel,
	title: string,
	message?: string,
): WorkDoneProgress {
	const token = `acode-worker-progress-${++nextToken}`;
	let created = channel.ready.then(
		(supported) =>
			supported &&
			channel.request("window/workDoneProgress/create", { token }).then(
				() => true,
				() => false,
			),
	);
	let ended = false;
	const send = (value: Record<string, unknown>) => {
		created = created.then((usable) => {
			if (usable) channel.notify("$/progress", { token, value });
			return usable;
		});
	};

	send({ kind: "begin", title, message, cancellable: false });
	return {
		report(text, percentage) {
			if (!ended) send({ kind: "report", message: text, percentage });
		},
		end(text) {
			if (ended) return;
			ended = true;
			send({ kind: "end", message: text });
		},
	};
}
