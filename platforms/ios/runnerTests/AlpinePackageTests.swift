import XCTest
import WebKit

@MainActor
final class AlpinePackageTests: BridgeTestCase {
    func testCompressedArchivePreservesPermissionsAndSymlinks() async throws {
        let webView = try await editorWebView()
        let result = try await webView.callAsyncJavaScript(#"""
            if (!await Terminal.isInstalled() && !await Terminal.install()) throw new Error(Terminal.lastInstallError);
            return await Executor.execute(`set -eu
                dir=$(mktemp -d /tmp/acode-archive-test.XXXXXX)
                trap 'rm -rf "$dir"' EXIT
                mkdir "$dir/source" "$dir/extracted"
                printf archive-probe > "$dir/source/tool"
                chmod 755 "$dir/source/tool"
                ln -s tool "$dir/source/link"
                tar -czf "$dir/archive.tar.gz" -C "$dir/source" .
                tar -xzf "$dir/archive.tar.gz" -C "$dir/extracted"
                test "$(cat "$dir/extracted/link")" = archive-probe
                test "$(readlink "$dir/extracted/link")" = tool
                test "$(stat -c %a "$dir/extracted/tool")" = 755
                printf invalid > "$dir/invalid.tar.gz"
                if tar -xzf "$dir/invalid.tar.gz" -C "$dir/extracted" 2>/dev/null; then exit 1; fi
                printf ARCHIVE_PASS`, true);
            """#, arguments: [:], in: nil, contentWorld: .page) as? String
        XCTAssertEqual(result, "ARCHIVE_PASS")
    }

    func testLinuxProcessInspectionAndDirectoryRemoval() async throws {
        let webView = try await editorWebView()
        let result = try await webView.callAsyncJavaScript(#"""
            if (!await Terminal.isInstalled() && !await Terminal.install()) throw new Error(Terminal.lastInstallError);
            await Executor.execute('apk add --no-cache nodejs procps-ng', true);
            const code = `
                const assert = require('node:assert/strict');
                const fs = require('node:fs');
                const child = require('node:child_process');
                const stat = fs.readFileSync('/proc/self/stat', 'utf8');
                const start = Number(stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\\s+/)[19]);
                assert(start > 0);
                const details = child.execFileSync('ps', ['-p', String(process.pid), '-o', 'stat=', '-o', 'lstart='], {encoding:'utf8'});
                assert.match(details, /^[A-Z+<NlSs]+\\s+\\w{3}\\s+\\w{3}\\s+\\d+\\s+\\d{2}:\\d{2}:\\d{2}\\s+\\d{4}/);
                for (const root of ['/tmp/', '/public/']) {
                    const dir = fs.mkdtempSync(root + 'acode-fs-probe-');
                    const link = dir + '.link';
                    try {
                        assert.throws(() => fs.unlinkSync(dir), {code:'EISDIR'});
                        fs.symlinkSync(dir, link);
                        fs.unlinkSync(link);
                        assert(fs.statSync(dir).isDirectory());
                        fs.mkdirSync(dir + '/child');
                        fs.writeFileSync(dir + '/child/file', 'probe');
                        fs.rmSync(dir, {recursive:true});
                        assert(!fs.existsSync(dir));
                    } finally {
                        fs.rmSync(link, {force:true});
                        fs.rmSync(dir, {recursive:true, force:true});
                    }
                }
                console.log('LINUX_COMPAT_PASS');`;
            return await Executor.execute('node -e ' + "'" + code.replaceAll("'", "'\\''") + "'", true);
            """#, arguments: [:], in: nil, contentWorld: .page) as? String
        XCTAssertEqual(result, "LINUX_COMPAT_PASS")
    }

    func testNodeNpmAndLinuxSubprocesses() async throws {
        let webView = try await editorWebView()
        let result = try await webView.callAsyncJavaScript(#"""
            if (!await Terminal.isInstalled() && !await Terminal.install()) throw new Error(Terminal.lastInstallError);
            await Executor.execute('apk add --no-cache nodejs npm', true);
            const fs = acode.require('fs');
            const path = 'alpine://localhost/tmp/acode-node-probe.js';
            const code = `
                const assert = require('node:assert/strict');
                const fs = require('node:fs');
                const http = require('node:http');
                const child = require('node:child_process');
                const startup = child.spawnSync(process.execPath, ['-e', 'process.stdout.write(typeof WebAssembly)'], {encoding:'utf8'});
                assert.equal(startup.status, 0);
                assert.equal(startup.stdout, 'undefined');
                assert.equal(startup.stderr, '');
                assert.equal(1 + 2, 3);
                fs.writeFileSync('/tmp/acode-node-utf8', 'hello π');
                assert.equal(fs.readFileSync('/tmp/acode-node-utf8', 'utf8'), 'hello π');
                assert.equal(child.execFileSync('/bin/sh', ['-c', 'printf subprocess'], {encoding:'utf8'}), 'subprocess');
                const server = http.createServer((req, res) => res.end('loopback'));
                server.listen(0, '127.0.0.1', () => {
                    http.get('http://127.0.0.1:' + server.address().port, res => {
                        let body = '';
                        res.on('data', data => body += data);
                        res.on('end', () => {
                            assert.equal(body, 'loopback');
                            server.close(() => console.log('NODE_PASS'));
                        });
                    });
                });`;
            if (await fs(path).exists()) await fs(path).delete();
            await fs('alpine://localhost/tmp').createFile('acode-node-probe.js', code);
            const node = await Executor.execute('node /tmp/acode-node-probe.js', true);
            if (node !== 'NODE_PASS') throw new Error('Node check: ' + node);
            await Executor.execute('npm install --ignore-scripts --no-audit --no-fund --cache /tmp/acode-npm-cache --prefix /tmp/acode-npm-probe is-number@7.0.0', true);
            const npm = await Executor.execute('node -p "require(\'/tmp/acode-npm-probe/node_modules/is-number\')(42)"', true);
            if (npm !== 'true') throw new Error('npm package check: ' + npm);
            await Executor.execute('rm -rf /tmp/acode-node-probe.js /tmp/acode-node-utf8 /tmp/acode-npm-probe /tmp/acode-npm-cache', true);
            return {node, npm};
            """#, arguments: [:], in: nil, contentWorld: .page) as? [String: String]
        XCTAssertEqual(result?["node"], "NODE_PASS")
        XCTAssertEqual(result?["npm"], "true")
    }
}
