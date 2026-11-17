import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";

const directories = [];
afterEach(() => {
	for (const directory of directories.splice(0)) {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

test("Alpine keeps unchanged builds incremental and rebuilds after an SDK change", () => {
	const fixture = createFixture();
	fixture.run("/sdk/old");
	fixture.run("/sdk/old");
	expect(fixture.calls()).toHaveLength(1);
	fs.writeFileSync(path.join(fixture.build, "old-sdk-object.o"), "stale");
	fixture.run("/sdk/new");
	expect(fixture.calls()).toHaveLength(2);
	expect(fs.existsSync(path.join(fixture.build, "old-sdk-object.o"))).toBe(
		false,
	);
	expect(
		fs.readFileSync(path.join(fixture.build, "configured-cross.ini"), "utf8"),
	).toContain("/sdk/new");
	fixture.run("/sdk/new");
	expect(fixture.calls()).toHaveLength(2);
});

test("Alpine repairs legacy caches and retries a failed reconfiguration", () => {
	const fixture = createFixture();
	fs.mkdirSync(path.join(fixture.build, "meson-private"), { recursive: true });
	fs.writeFileSync(path.join(fixture.build, "build.ninja"), "legacy SDK cache");
	fixture.run("/sdk/current", true);
	expect(fs.existsSync(path.join(fixture.build, "configured-cross.ini"))).toBe(
		false,
	);
	fixture.run("/sdk/current");
	expect(fixture.calls()).toHaveLength(2);
	expect(
		fs.readFileSync(path.join(fixture.build, "configured-cross.ini"), "utf8"),
	).toContain("/sdk/current");
});

function createFixture() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "acode-alpine-build-"));
	directories.push(root);
	const tools = path.join(root, "tools");
	const derived = path.join(root, "derived");
	const build = path.join(derived, "Alpine-iphonesimulator");
	const log = path.join(root, "setup.log");
	fs.mkdirSync(tools);
	const stub = `#!${process.execPath}
const fs=require('fs'),path=require('path');
const args=process.argv.slice(2),tool=path.basename(process.argv[1]);
if(tool==='meson') {
 const build=args.find(arg=>arg.endsWith('/Alpine-iphonesimulator'));
 const cross=args[args.indexOf('--cross-file')+1];
 fs.appendFileSync(process.env.SETUP_LOG,JSON.stringify(args)+'\\n');
 if(args.includes('--wipe')) fs.rmSync(build,{recursive:true,force:true});
 if(!fs.existsSync(cross)) throw Error('Wipe removed cross file');
 fs.mkdirSync(path.join(build,'meson-private'),{recursive:true});
 if(process.env.FAIL_SETUP==='1') process.exit(1);
 fs.writeFileSync(path.join(build,'build.ninja'),'configured');
} else if(tool==='ninja') {
 const build=args[args.indexOf('-C')+1];
 fs.mkdirSync(path.join(build,'vdso/arm64'),{recursive:true});
 fs.writeFileSync(path.join(build,'vdso/arm64/libvdso.so.elf'),'fixture');
}
`;
	for (const name of ["shasum", "meson", "ninja", "ld.lld"]) {
		fs.writeFileSync(path.join(tools, name), stub, { mode: 0o755 });
	}
	return {
		build,
		calls: () => fs.readFileSync(log, "utf8").trim().split("\n"),
		run(sdk, fail = false) {
			const result = spawnSync("/bin/bash", ["platforms/ios/Alpine/build.sh"], {
				encoding: "utf8",
				env: {
					PATH: `${tools}:/usr/bin:/bin`,
					ACODE_BUILD_TOOLS: tools,
					ACODE_LLD_BIN: tools,
					SDKROOT: sdk,
					DERIVED_FILE_DIR: derived,
					PLATFORM_NAME: "iphonesimulator",
					SETUP_LOG: log,
					FAIL_SETUP: fail ? "1" : "0",
				},
			});
			expect(result.status, result.stderr).toBe(fail ? 1 : 0);
		},
	};
}
