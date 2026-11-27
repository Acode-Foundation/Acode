import XCTest
import WebKit

@MainActor
final class AlpineInteractionTests: BridgeTestCase {
    func testOrphanedTerminalProcessExitsAfterSessionLeader() async throws {
        let webView = try await editorWebView()
        let result = try await webView.callAsyncJavaScript(#"""
            if (!await Terminal.isInstalled() && !await Terminal.install()) throw new Error(Terminal.lastInstallError);
            const manager = acode.require('terminal');
            const terminal = await manager.createServer({name:'Alpine orphan cleanup'});
            const parent = Number(terminal.component.pid);
            let directory;
            let child;
            const content = () => {
                const buffer = terminal.component.terminal.buffer.active;
                return Array.from({length:buffer.length}, (_, i) => buffer.getLine(i)?.translateToString()).join('\n');
            };
            const waitFor = async check => {
                for (let i = 0; i < 100; i++) {
                    if (await check()) return;
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
                throw new Error('Orphan cleanup timed out: '+content());
            };
            const childExited = async () => !(await Executor.listAllProcesses()).some(process => process.pid === child);
            try {
                directory = await Executor.execute('mktemp -d /tmp/acode-orphan-test.XXXXXX', true);
                await waitFor(() => content().includes('root@localhost'));
                terminal.component.terminal.input(`sh -c 'trap "" HUP; echo $$ > "$1/pid"; echo ORPHAN:$$; while [ ! -e "$1/release" ]; do sleep 0.1; done' sh "${directory}" & disown\r`);
                await waitFor(() => /ORPHAN:(\d+)/.test(content()));
                child = Number(content().match(/ORPHAN:(\d+)/)[1]);
                terminal.component.terminal.input('exit\r');
                await waitFor(async () => {
                    const processes = await Executor.listAllProcesses();
                    return !processes.some(process => process.pid === parent) && processes.some(process => process.pid === child);
                });
                await Executor.execute(`touch "${directory}/release"`, true);
                await waitFor(childExited);
                return await Executor.execute('printf ORPHAN_CLEANUP_PASS', true);
            } finally {
                try {
                    if (directory) {
                        await Executor.execute(`touch "${directory}/release"`, true);
                        child ||= Number(await Executor.execute(`cat "${directory}/pid" 2>/dev/null || true`, true));
                        if (child) {
                            try { await waitFor(childExited); }
                            catch {
                                await Executor.killProcess(child).catch(() => {});
                                await waitFor(childExited);
                            }
                        }
                    }
                } finally {
                    try { await manager.close(terminal.id); }
                    finally {
                        if (directory) await Executor.execute(`rm -rf "${directory}"`, true);
                    }
                }
            }
            """#, arguments: [:], in: nil, contentWorld: .page) as? String
        XCTAssertEqual(result, "ORPHAN_CLEANUP_PASS")
    }

    func testExistingTerminalUIAndSessionIsolation() async throws {
        let webView = try await editorWebView()
        let result = try await webView.callAsyncJavaScript(#"""
            if (!await Terminal.isInstalled() && !await Terminal.install()) throw new Error(Terminal.lastInstallError);
            const manager = acode.require('terminal');
            const first = await manager.createServer({name:'Alpine first'});
            const second = await manager.createServer({name:'Alpine second'});
            const content = instance => {
                const buffer = instance.component.terminal.buffer.active;
                return Array.from({length:buffer.length}, (_, i) => buffer.getLine(i)?.translateToString()).join('\n');
            };
            const wait = async (instance, text) => {
                for (let i = 0; i < 100; i++) {
                    if (content(instance).includes(text)) return;
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
                throw new Error('Missing ' + text + ': ' + content(instance));
            };
            const input = (instance, text) => instance.component.terminal.input(text);
            try {
                input(first, 'cd /tmp; export ACODE_CHECK=first; printf "ONE:%s:%s\\n" "$PWD" "$ACODE_CHECK"\r');
                input(second, 'cd /etc; export ACODE_CHECK=second; printf "TWO:%s:%s\\n" "$PWD" "$ACODE_CHECK"\r');
                await wait(first, 'ONE:/tmp:first');
                await wait(second, 'TWO:/etc:second');
                const processes = await Executor.listAllProcesses();
                for (const terminal of [first, second]) {
                    if (!processes.some(process => process.pid === Number(terminal.component.pid))) throw new Error('Terminal missing from process list');
                }
                await first.component.resizeTerminal(100, 40, true);
                input(first, 'stty size\r');
                await wait(first, '40 100');
                input(first, 'sleep 30\r');
                let sleeping = false;
                for (let i = 0; i < 50; i++) {
                    if ((await Executor.listAllProcesses()).some(process => process.name === 'sleep')) { sleeping = true; break; }
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
                if (!sleeping) throw new Error('Foreground sleep did not start');
                input(first, '\x03');
                input(first, 'printf "SIGNAL:%s\\n" "$?"\r');
                await wait(first, 'SIGNAL:130');
                input(second, 'printf "STILL:%s\\n" "$ACODE_CHECK"\r');
                await wait(second, 'STILL:second');
                input(first, 'read -p "READY:$((1+1))" value; printf "INPUT:%s\\n" "$value"\r');
                await wait(first, 'READY:2');
                input(first, 'hello\r');
                await wait(first, 'INPUT:hello');
                const dropped = second.component.websocket;
                dropped.close();
                for (let i = 0; i < 100 && (second.component.websocket === dropped || !second.component.isConnected); i++) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
                if (!second.component.isConnected) throw new Error('Terminal did not reconnect');
                await wait(second, 'STILL:second');
                input(second, 'printf "BACK:%s\\n" "$ACODE_CHECK"\r');
                await wait(second, 'BACK:second');
                second.component.options.port = 9;
                const lost = second.component.websocket;
                lost.close();
                for (let i = 0; i < 100 && !second.component.disconnected; i++) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
                if (!second.component.disconnected || second.component.intentionalClose) throw new Error('Tab was not kept after reconnect failures');
                second.component.options.port = 8767;
                document.dispatchEvent(new CustomEvent('resume'));
                for (let i = 0; i < 100 && (second.component.websocket === lost || !second.component.isConnected); i++) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
                input(second, 'printf "AGAIN:%s\\n" "$ACODE_CHECK"\r');
                await wait(second, 'AGAIN:second');
                return {first:content(first), second:content(second)};
            } finally {
                await manager.close(first.id);
                await manager.close(second.id);
            }
            """#, arguments: [:], in: nil, contentWorld: .page) as? [String: String]
        XCTAssertTrue(result?["first"]?.contains("SIGNAL:130") == true)
        XCTAssertTrue(result?["second"]?.contains("AGAIN:second") == true)
    }
}
