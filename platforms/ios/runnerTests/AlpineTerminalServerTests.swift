import Network
import XCTest
import WebKit

@MainActor
final class AlpineTerminalServerTests: BridgeTestCase {
    func testCongestedWriterStillReceivesSignals() async throws {
        let webView = try await editorWebView()
        let pid = try await webView.callAsyncJavaScript(Self.prelude + #"""
            return (await request('/terminals', {cols:80, rows:24})).data.trim();
            """#, arguments: [:], in: nil, contentWorld: .page) as? String ?? ""
        let socket = RawWebSocket()
        try await socket.open("/terminals/\(pid)")
        // The client stops reading, so `cat` fills the socket and must block in the guest.
        try await socket.send("cat /dev/zero\r")
        let running = try await webView.callAsyncJavaScript(Self.prelude + #"""
            return await waitFor(async () => (await processes()).includes('cat'), 100);
            """#, arguments: [:], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(running, true)
        try await Task.sleep(for: .seconds(2))
        try await socket.send("\u{03}")
        let stopped = try await webView.callAsyncJavaScript(Self.prelude + #"""
            return await waitFor(async () => !(await processes()).includes('cat'), 50);
            """#, arguments: [:], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(stopped, true, "Ctrl-C did not reach a writer blocked on a congested client")
        socket.close()
        _ = try await webView.callAsyncJavaScript(Self.prelude + #"""
            await request('/terminals/' + pid + '/terminate', {});
            """#, arguments: ["pid": pid], in: nil, contentWorld: .page)
    }

    func testExecuteCommandRunsOnPtyWithResponseDeadline() async throws {
        let webView = try await editorWebView()
        let result = try await webView.callAsyncJavaScript(Self.prelude + #"""
            const execute = async body => {
                try { return JSON.parse((await request('/execute-command', body)).data); }
                catch (error) { return {status: error.status, ...JSON.parse(error.error || '{}')}; }
            };
            const tty = await execute({command: 'test -t 0 && stty size'});
            const missing = await execute({command: 'true', cwd: '/acode-missing-directory'});
            let started = Date.now();
            const background = await execute({command: 'sleep 60 & echo started'});
            const backgroundSeconds = (Date.now() - started) / 1000;
            started = Date.now();
            const timeout = await execute({command: 'sleep 45'});
            const timeoutSeconds = (Date.now() - started) / 1000;
            const sleepersKilled = await waitFor(async () => !(await processes()).includes('sleep'), 50);
            return {tty: tty.output, missing, background: background.output, backgroundSeconds,
                    timeout: timeout.error, timeoutSeconds, sleepersKilled};
            """#, arguments: [:], in: nil, contentWorld: .page) as? [String: Any]
        XCTAssertTrue((result?["tty"] as? String)?.contains("24 80") == true, "\(String(describing: result))")
        XCTAssertEqual((result?["missing"] as? [String: Any])?["status"] as? Int, 400)
        XCTAssertTrue((result?["background"] as? String)?.contains("started") == true)
        XCTAssertLessThan(result?["backgroundSeconds"] as? Double ?? 99, 10)
        XCTAssertEqual(result?["timeout"] as? String, "Command execution timed out")
        XCTAssertLessThan(result?["timeoutSeconds"] as? Double ?? 99, 40)
        XCTAssertEqual(result?["sleepersKilled"] as? Bool, true)
    }

    private static let prelude = #"""
        if (!await Terminal.isInstalled() && !await Terminal.install()) throw new Error(Terminal.lastInstallError);
        await Terminal.startAxs();
        const request = (path, data) => new Promise((resolve, reject) => Bridge.http.sendRequest(
            'http://127.0.0.1:8767' + path,
            {method:'POST', serializer:'json', responseType:'text', data},
            resolve, reject));
        const processes = async () => (await Executor.listAllProcesses()).map(process => process.name);
        const waitFor = async (check, attempts) => {
            for (let i = 0; i < attempts; i++) {
                if (await check()) return true;
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            return false;
        };

        """#
}

/// A WebSocket client that only reads the handshake, so tests can stop draining output.
private final class RawWebSocket {
    private let connection = NWConnection(host: "127.0.0.1", port: 8767, using: .tcp)
    private let queue = DispatchQueue(label: "app.acode.tests.raw-websocket")

    func open(_ path: String) async throws {
        connection.start(queue: queue)
        let key = Data((0..<16).map { _ in UInt8.random(in: 0...255) }).base64EncodedString()
        try await write(Data("GET \(path) HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: \(key)\r\nSec-WebSocket-Version: 13\r\n\r\n".utf8))
        var head = Data()
        while head.range(of: Data("\r\n\r\n".utf8)) == nil { head.append(try await read()) }
        guard String(decoding: head, as: UTF8.self).hasPrefix("HTTP/1.1 101") else {
            throw NSError(domain: "AcodeTests", code: 3, userInfo: [NSLocalizedDescriptionKey: "Upgrade failed"])
        }
    }

    func send(_ text: String) async throws {
        let payload = Array(text.utf8)
        let mask = (0..<4).map { _ in UInt8.random(in: 0...255) }
        var frame = Data([0x81, 0x80 | UInt8(payload.count)] + mask)
        frame.append(contentsOf: payload.enumerated().map { $1 ^ mask[$0 & 3] })
        try await write(frame)
    }

    func close() {
        connection.cancel()
    }

    private func write(_ data: Data) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            connection.send(content: data, completion: .contentProcessed { error in
                if let error { continuation.resume(throwing: error) } else { continuation.resume() }
            })
        }
    }

    private func read() async throws -> Data {
        try await withCheckedThrowingContinuation { continuation in
            connection.receive(minimumIncompleteLength: 1, maximumLength: 4096) { data, _, complete, error in
                if let error { continuation.resume(throwing: error) }
                else if complete, data?.isEmpty ?? true { continuation.resume(throwing: NWError.posix(.ECONNRESET)) }
                else { continuation.resume(returning: data ?? Data()) }
            }
        }
    }
}
