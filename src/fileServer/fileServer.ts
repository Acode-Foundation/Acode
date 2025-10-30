import {FileObject} from "../fileSystem/fileObject";
import {Log} from "../lib/Log";


class FileServer {
    private readonly file: FileObject;
    private readonly port: number;
    private httpServer:Server | undefined;
    private readonly log:Log = new Log("fileServer");

    constructor(port:number,file:FileObject) {
        this.file = file;
        this.port = port;
    }

    start(onSuccess: (msg: any) => void, onError: (err: any) => void,):void{
        this.httpServer = CreateServer(this.port,onSuccess,onError)

        // @ts-ignore
        httpServer.setOnRequestHandler(this.handleRequest.bind(this));
    }

    private handleRequest(req: { requestId: string; path: string }): void {
        this.log.d("Request received:", req);
        // handle file serving logic here
        this.log.d("Received request:", req.requestId);
        this.log.d("Request Path", req.path);
        this.sendText("This is a test",req.requestId,null)
        this.log.d("Response sent")
    }

    private sendText(text:string, id:string, mimeType:string | null | undefined) {
        this.httpServer?.send(id, {
            status: 200,
            body: text,
            headers: {
                "Content-Type": mimeType || "text/html",
            },
        },()=>{},this.log.e);
    }


}