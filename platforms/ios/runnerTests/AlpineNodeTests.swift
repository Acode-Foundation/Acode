import XCTest
import WebKit

@MainActor
final class AlpineNodeTests: BridgeTestCase {
    func testViteReactDevelopmentAndBuild() async throws {
        let result = try await runNode("acode-vite-probe.js", #"""
            const assert = require('node:assert/strict');
            const fs = require('node:fs');
            const net = require('node:net');
            const child = require('node:child_process');
            const dir = fs.mkdtempSync('/tmp/acode-vite-');
            let server;
            let log = '';
            (async () => {
                fs.writeFileSync(dir + '/package.json', JSON.stringify({
                    private: true, type: 'module',
                    scripts: {dev: 'vite --host 0.0.0.0', build: 'vite build'},
                    dependencies: {react: '19.2.4', 'react-dom': '19.2.4', 'lucide-react': '1.68.0'},
                    devDependencies: {vite: '8.3.8', '@vitejs/plugin-react': '6.0.0'}
                }));
                fs.writeFileSync(dir + '/vite.config.js', "import {defineConfig} from 'vite'; import react from '@vitejs/plugin-react'; export default defineConfig({plugins:[react()]});");
                fs.writeFileSync(dir + '/index.html', '<div id="root"></div><script type="module" src="/main.jsx"></script>');
                fs.writeFileSync(dir + '/main.jsx', "import React from 'react'; import {createRoot} from 'react-dom/client'; import {Clock} from 'lucide-react'; createRoot(document.getElementById('root')).render(<div>vite-probe<Clock /></div>);");
                const options = {cwd: dir, encoding: 'utf8', timeout: 180000};
                child.execFileSync('npm', ['install', '--no-audit', '--no-fund'], options);
                const port = await freePort();
                server = child.spawn('npm', ['run', 'dev', '--', '--port', String(port), '--strictPort'], {cwd: dir, detached: true, env: {...process.env, NO_COLOR: '1'}});
                const record = data => { log = (log + data).slice(-8000); };
                server.stdout.on('data', record);
                server.stderr.on('data', record);
                const url = 'http://127.0.0.1:' + port + '/';
                const page = await waitForServer(url, Date.now() + 120000);
                assert.match(page, /@vite\/client/);
                const module = await fetch(url + 'main.jsx');
                assert.equal(module.status, 200);
                assert.match(await module.text(), /vite-probe/);
                child.execFileSync('npm', ['run', 'build'], options);
                assert.match(fs.readFileSync(dir + '/dist/index.html', 'utf8'), /assets\//);
                console.log('VITE_REACT_PASS');
            })().catch(error => { console.error(error, log); process.exitCode = 1; }).finally(() => {
                if (server?.pid) { try { process.kill(-server.pid, 'SIGTERM'); } catch {} }
                fs.rmSync(dir, {recursive: true, force: true});
            });

            function freePort() {
                return new Promise((resolve, reject) => {
                    const probe = net.createServer().once('error', reject);
                    probe.listen(0, '127.0.0.1', () => {
                        const {port} = probe.address();
                        probe.close(() => resolve(port));
                    });
                });
            }

            async function waitForServer(url, deadline) {
                for (;;) {
                    const remaining = deadline - Date.now();
                    assert(remaining > 0, 'Vite did not start: ' + log);
                    assert.equal(server.exitCode, null, 'Vite exited: ' + log);
                    try {
                        const response = await fetch(url, {signal: AbortSignal.timeout(Math.min(10000, remaining))});
                        if (response.status === 200) {
                            const page = await response.text();
                            if (Date.now() < deadline) return page;
                        }
                        await response.body?.cancel();
                    } catch {}
                    assert(Date.now() < deadline, 'Vite did not start: ' + log);
                    await new Promise(resolve => setTimeout(resolve, Math.min(500, deadline - Date.now())));
                }
            }
            """#)
        XCTAssertEqual(result, "VITE_REACT_PASS")
    }

    func testWebAssemblyWorkersAndLoopbackFetch() async throws {
        let result = try await runNode("acode-node-runtime-probe.js", #"""
            const assert = require('node:assert/strict');
            const http = require('node:http');
            const { MessageChannel, Worker } = require('node:worker_threads');
            (async () => {
                const interfaces = Object.values(require('node:os').networkInterfaces()).flat();
                assert(interfaces.some(address => address.internal && address.address === '127.0.0.1' && address.netmask === '255.0.0.0'));
                const bytes = Uint8Array.from([0,97,115,109,1,0,0,0,1,7,1,96,2,127,127,1,127,3,2,1,0,7,7,1,3,97,100,100,0,0,10,9,1,7,0,32,0,32,1,106,11]);
                const { instance } = await WebAssembly.instantiate(bytes);
                assert.equal(instance.exports.add(19, 23), 42);
                console.log('WASM_PASS');
                const { port1, port2 } = new MessageChannel();
                await new Promise(resolve => {
                    port1.addEventListener('message', event => {
                        assert.equal(event.data, 42);
                        port1.close(); port2.close(); resolve();
                    }, {once: true});
                    port1.start(); port2.postMessage(42);
                });
                const worker = new Worker("require('node:worker_threads').parentPort.postMessage(typeof WebAssembly + ':' + 6 * 7)", {eval: true});
                const [message] = await require('node:events').once(worker, 'message');
                assert.equal(message, 'object:42');
                await worker.terminate();
                console.log('WORKER_PASS');
                const server = http.createServer((req, res) => res.end('loopback π'));
                await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
                try {
                    const response = await fetch('http://127.0.0.1:' + server.address().port);
                    assert.equal(await response.text(), 'loopback π');
                } finally { server.closeAllConnections(); server.close(); }
                console.log('FETCH_PASS');
            })().catch(error => { console.error(error); process.exitCode = 1; });
            """#)
        XCTAssertEqual(result, "WASM_PASS\nWORKER_PASS\nFETCH_PASS")
    }

    func testNodeNamedDeviceFailsWithoutScanning() async throws {
        let webView = try await editorWebView()
        let result = try await webView.callAsyncJavaScript(#"""
            if (!await Terminal.isInstalled() && !await Terminal.install()) throw new Error(Terminal.lastInstallError);
            return await Executor.execute(`dir=$(mktemp -d /tmp/acode-node-device.XXXXXX)
                ln -s /dev/zero "$dir/node"
                "$dir/node" 2>/dev/null
                status=$?
                rm -rf "$dir"
                printf "exit=%s" "$status"`, true);
            """#, arguments: [:], in: nil, contentWorld: .page) as? String
        XCTAssertEqual(result, "exit=126")
    }

    private func runNode(_ name: String, _ code: String) async throws -> String? {
        let webView = try await editorWebView()
        return try await webView.callAsyncJavaScript(#"""
            if (!await Terminal.isInstalled() && !await Terminal.install()) throw new Error(Terminal.lastInstallError);
            if (!await Executor.execute('command -v npm || true', true)) await Executor.execute('apk add --no-cache nodejs npm', true);
            const fs = acode.require('fs');
            const path = 'alpine://localhost/tmp/' + name;
            if (await fs(path).exists()) await fs(path).delete();
            await fs('alpine://localhost/tmp').createFile(name, code);
            try {
                return await Executor.execute('node /tmp/' + name, true);
            } finally {
                await fs(path).delete();
            }
            """#, arguments: ["name": name, "code": code], in: nil, contentWorld: .page) as? String
    }
}
