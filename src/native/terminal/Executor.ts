import bridge from "../bridge";
import exec from "../exec";

export interface ProcessInfo {
	id: string;
	pid: number;
	command: string;
	alpine: boolean;
	startedAt: number;
	background: boolean;
}
export interface OSProcess {
	pid: number;
	ppid: number;
	name: string;
	command: string;
	state: string;
	memory: number;
	isSelf: boolean;
}
type OutputListener = (type: string, data: string) => void;

class Executor {
	private readonly call: ReturnType<typeof bridge>;
	readonly ExecutorType: string;
	constructor(background = false) {
		this.ExecutorType = background ? "BackgroundExecutor" : "Executor";
		this.call = bridge(this.ExecutorType);
	}
	spawnStream(
		command: string[],
		callback: (socket: WebSocket) => void,
		onError?: (error: unknown) => void,
	) {
		exec(
			(port) => {
				const socket = new WebSocket(`ws://127.0.0.1:${port}`);
				socket.binaryType = "arraybuffer";
				socket.onopen = () => callback(socket);
				socket.onerror = (event) => onError?.(event);
			},
			(error) => onError?.(error),
			"Executor",
			"spawn",
			[command],
		);
	}
	start(
		command: string,
		onData: OutputListener,
		alpine = false,
	): Promise<string> {
		return new Promise((resolve, reject) => {
			let first = true;
			exec(
				async (message: string) => {
					if (first) {
						first = false;
						await new Promise((resolve) => setTimeout(resolve, 100));
						resolve(message);
					} else {
						const match = /^([^:]+):(.*)$/.exec(message);
						onData(match?.[1] ?? "unknown", match?.[2] ?? message);
					}
				},
				reject,
				this.ExecutorType,
				"start",
				[command, String(alpine)],
			);
		});
	}
	write(id: string, input: string) {
		return this.call<string>("write", [id, input]);
	}
	moveToBackground() {
		return this.call<string>("moveToBackground");
	}
	moveToForeground() {
		return this.call<string>("moveToForeground");
	}
	stop(id: string) {
		return this.call<string>("stop", [id]);
	}
	async isRunning(id: string) {
		return (await this.call<string>("isRunning", [id])) === "running";
	}
	async listProcesses() {
		return (await this.call<ProcessInfo[]>("listProcesses")).map((process) => ({
			...process,
			background: this.ExecutorType === "BackgroundExecutor",
		}));
	}
	listAllProcesses() {
		return this.call<OSProcess[]>("listAllProcesses");
	}
	killProcess(pid: number) {
		return this.call<string>("killProcess", [pid]);
	}
	stopService() {
		return this.call<string>("stopService");
	}
	execute(command: string, alpine = false) {
		return this.call<string>("exec", [command, String(alpine)]);
	}
	loadLibrary(path: string) {
		return this.call<string>("loadLibrary", [path]);
	}
	setProotDebug(enabled: boolean) {
		return this.call<string>("setProotDebug", [enabled]);
	}
}

export default Object.assign(new Executor(), {
	BackgroundExecutor: new Executor(true),
});
