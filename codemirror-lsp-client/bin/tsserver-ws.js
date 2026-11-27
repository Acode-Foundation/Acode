import {WebSocketServer} from "ws"
import {spawn} from "node:child_process"
import {join} from "node:path"

let project = join(import.meta.dirname, "..", "test")

let server = new WebSocketServer({port: 8777})

class MessageReader {
  message = ""
  pending = -1

  constructor(onMessage) { this.onMessage = onMessage }

  data(data) {
    this.message += data
    console.log("GET ", data)
    for (;;) {
      if (this.pending == -1) {
        let brk = this.message.indexOf("\r\n\r\n")
        if (brk < 0) break
        let len = /content-length: (\d+)/i.exec(this.message.slice(0, brk))
        if (!len) throw new Error("Missing content-length header")
        this.message = this.message.slice(brk + 4)
        this.pending = +len[1]
        console.log("parsed header", this.pending, "msg=", this.message)
      } else if (this.pending <= this.message.length) {
        console.log('finished', this.pending)
        this.onMessage(this.message.slice(0, this.pending))
        this.message = this.message.slice(this.pending)
        this.pending = -1
      } else {
        console.log("out")
        break
      }
    }        
  }
}

server.on("connection", sock => {
  console.log("New connection")
  let ts = spawn(join(import.meta.dirname, "..", "..", "node_modules", ".bin", "typescript-language-server"), ["--stdio"], {
    cwd: project,
    encoding: "utf8",
    stdio: ["pipe", "pipe", process.stderr]
  })
  let reader = new MessageReader(message => {
    console.log("==> " + message)
    sock.send(message)
  })
  ts.stdout.on("data", blob => reader.data(blob.toString("utf8")))
  ts.on("close", () => {
    sock.close()
  })
  sock.on("error", console.error)
  sock.on("message", data => {
    console.log("<== " + data)
    ts.stdin.write(`Content-Length: ${data.length}\r\n\r\n${data}`)
  })
  sock.on("close", () => {
    console.log("Closed")
    ts.kill()
  })
})
