import { FileObject } from "../fileSystem/fileObject";
import { Log } from "./Log";

export class FileServer {
	private readonly file: FileObject;
	private readonly port: number;
	private httpServer: Server | undefined;
	private readonly log: Log = new Log("fileServer");

	constructor(port: number, file: FileObject) {
		this.file = file;
		this.port = port;
	}

	start(onSuccess: (msg: any) => void, onError: (err: any) => void): void {
		this.httpServer = CreateServer(this.port, onSuccess, onError);

		// @ts-ignore
		this.httpServer.setOnRequestHandler(this.handleRequest.bind(this));
	}

	private async handleRequest(req: {
		requestId: string;
		path: string;
	}): Promise<void> {
		this.log.d("Request received:", req);
		this.log.d("Received request:", req.requestId);
		this.log.d("Request Path", req.path);

		if (await this.file.isFile()) {
			this.sendText(
				(await this.file?.readText()) ?? "null",
				req.requestId,
				this.getMimeType(await this.file.getName()),
			);
			return;
		}

		if (req.path === "/") {
			const indexFile = await this.file.getChildByName("index.html");
			if ((await indexFile?.exists()) && (await indexFile?.canRead())) {
				this.sendText(
					(await indexFile?.readText()) ?? "null",
					req.requestId,
					this.getMimeType(await indexFile!!.getName()),
				);
			} else {
				this.sendText("404 index file not found", req.requestId, "text/plain");
			}
			return;
		}

		let targetFile: FileObject | null = null;

		for (const name of req.path.split("/")) {
			if (!name) continue; // skip empty parts like leading or trailing "/"

			if (targetFile === null) {
				targetFile = await this.file.getChildByName(name);
			} else {
				targetFile = await targetFile.getChildByName(name);
			}

			if (targetFile === null) {
				// Stop early if file is missing
				break;
			}
		}

		if (targetFile == null || !(await targetFile!!.exists())) {
			this.sendText(
				"404 file not found: " + req.path,
				req.requestId,
				"text/plain",
			);
			return;
		}

		this.sendText(
			(await targetFile?.readText()) ?? "null",
			req.requestId,
			this.getMimeType(await targetFile.getName()),
		);
	}

	private sendText(
		text: string,
		id: string,
		mimeType: string | null | undefined,
	) {
		this.httpServer?.send(
			id,
			{
				status: 200,
				body: text,
				headers: {
					"Content-Type": mimeType || "text/html",
				},
			},
			() => {},
			this.log.e,
		);
	}

	private getMimeType(filename: string): string {
		const ext = filename.split(".").pop()?.toLowerCase();
		const map: Record<string, string> = {
			html: "text/html",
			css: "text/css",
			js: "application/javascript",
			json: "application/json",
			png: "image/png",
			jpg: "image/jpeg",
			jpeg: "image/jpeg",
			gif: "image/gif",
			svg: "image/svg+xml",
			txt: "text/plain",
			xml: "text/xml",
		};
		return map[ext ?? "text/plain"];
	}
}
