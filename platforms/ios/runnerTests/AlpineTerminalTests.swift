import XCTest
import WebKit

@MainActor
final class AlpineTerminalTests: BridgeTestCase {
    func testAlpineInstallationExecutorAndInteractiveServer() async throws {
        let webView = try await editorWebView()
        let result = try await webView.callAsyncJavaScript(#"""
            const log = [];
            if (!await Terminal.isInstalled()) {
                if (!await Terminal.install(text => log.push(text), text => log.push(text))) {
                    throw new Error(Terminal.lastInstallError + '\n' + log.join('\n'));
                }
            }
            const executor = await Executor.execute("printf 'EXEC:%s\\n' \"$((6*7))\"", true);
            if (executor !== 'EXEC:42') throw new Error('Executor: ' + executor);
            let failure = '';
            try { await Executor.execute('echo expected-error >&2; exit 7', true); }
            catch (error) { failure = String(error); }
            if (!failure.includes('expected-error')) throw new Error('Missing nonzero exit: ' + failure);
            await Terminal.startAxs();
            const request = (path, data) => new Promise((resolve, reject) => Bridge.http.sendRequest(
                'http://127.0.0.1:8767' + path,
                data ? {method:'POST', serializer:'json', responseType:'text', data} : {method:'GET', responseType:'text'},
                resolve, reject));
            let ready = false;
            for (let i = 0; i < 100; i++) {
                try { ready = (await request('/status')).data.trim() === 'OK'; } catch {}
                if (ready) break;
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            if (!ready) throw new Error('AXS not ready');
            const attach = pid => {
                const socket = new WebSocket('ws://127.0.0.1:8767/terminals/' + pid);
                socket.binaryType = 'arraybuffer';
                const decoder = new TextDecoder();
                const waiters = [];
                let text = '';
                socket.onmessage = event => {
                    text += typeof event.data === 'string' ? event.data : decoder.decode(event.data, {stream: true});
                    for (const waiter of waiters.filter(waiter => text.includes(waiter.token))) waiter.resolve(text);
                };
                const opened = new Promise((resolve, reject) => {
                    socket.onopen = resolve;
                    socket.onerror = () => reject(new Error('PTY connection failed'));
                });
                const expect = token => new Promise((resolve, reject) => {
                    if (text.includes(token)) { resolve(text); return; }
                    const timeout = setTimeout(() => reject(new Error('PTY timeout waiting for ' + token + ': ' + text)), 15000);
                    waiters.push({token, resolve: value => { clearTimeout(timeout); resolve(value); }});
                });
                return {socket, opened, expect};
            };
            const pid = (await request('/terminals', {cols:80, rows:24})).data.trim();
            const first = attach(pid);
            await first.opened;
            first.socket.send("printf 'PTY:%s\\n' \"$((7*8))\"\n");
            const output = await first.expect('PTY:56');
            await request('/terminals/' + pid + '/resize', {cols:100, rows:40});
            first.socket.send('stty size\n');
            await first.expect('40 100');
            first.socket.close();
            const second = attach(pid);
            await second.opened;
            await second.expect('PTY:56');
            second.socket.send('exit\n');
            await second.expect('"type":"exit"');
            const other = (await request('/terminals', {cols:80, rows:24})).data.trim();
            await request('/terminals/' + other + '/terminate', {});
            const fs = acode.require('fs');
            const directory = 'alpine://localhost/tmp/acode-files-test';
            await Executor.execute('mkdir -p /tmp/acode-files-test', true);
            const file = await fs(directory).createFile('नमस्ते & file.txt', 'hello π\n');
            if (await fs(file).readFile('utf-8') !== 'hello π\n') throw new Error('Guest read/write mismatch');
            await fs(file).writeFile('updated\n');
            const entries = await fs(directory).lsDir();
            if (!entries.some(entry => entry.name === 'नमस्ते & file.txt')) throw new Error('Guest listing mismatch');
            await fs(directory).delete();
            const cached = Bridge.file.cacheDirectory + 'alpine-shared.txt';
            await fs(Bridge.file.cacheDirectory).createFile('alpine-shared.txt', 'shared');
            const quote = text => "'" + text.replaceAll("'", "'\\''") + "'";
            if (await Executor.execute('cat ' + quote(decodeURIComponent(new URL(cached).pathname)), true) !== 'shared') {
                throw new Error('Host Files mapping mismatch');
            }
            await fs(cached).delete();
            const stream = await new Promise((resolve, reject) => Executor.spawnStream(['/bin/cat'], resolve, reject));
            const echoed = new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Process stream timeout')), 5000);
                stream.onmessage = event => { clearTimeout(timeout); resolve(new TextDecoder().decode(event.data)); };
            });
            stream.send(new TextEncoder().encode('binary π\n'));
            if (await echoed !== 'binary π\n') throw new Error('Raw process stream mismatch');
            stream.close();
            await Executor.execute('printf before > /etc/acode-backup-test', true);
            await Terminal.backup();
            await Executor.execute('printf after > /etc/acode-backup-test', true);
            await Terminal.restore();
            if (await Executor.execute('cat /etc/acode-backup-test', true) !== 'before') throw new Error('Backup did not restore');
            await Executor.execute('rm /etc/acode-backup-test', true);
            await Terminal.clearBackup();
            return {executor, output, installed: await Terminal.isInstalled()};
            """#, arguments: [:], in: nil, contentWorld: .page) as? [String: Any]
        XCTAssertEqual(result?["executor"] as? String, "EXEC:42")
        XCTAssertEqual(result?["installed"] as? Bool, true)
        XCTAssertTrue((result?["output"] as? String)?.contains("PTY:56") == true)
    }
}
