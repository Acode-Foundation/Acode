import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

const kernel = "platforms/ios/Alpine/Vendor/ios-linuxkit";
const hasClang = spawnSync("clang", ["--version"]).status === 0;
const nativeTest = test.skipIf(!hasClang && !process.env.CI);
const sanitizers = hasClang ? sanitizerFlags() : [];

nativeTest(
	"Alpine encodes Linux interface dumps and rejects unsupported requests",
	() => {
		const result = runNative(
			[
				"platforms/ios/Alpine/Tests/netlink-route.c",
				`${kernel}/fs/netlink_route.c`,
			],
			[],
		);
		expect(result.stdout.trim()).toBe("NETLINK_ROUTE_PASS");
	},
);

nativeTest("Alpine only passes V8 flags the installed Node accepts", () => {
	const result = runNative(
		[
			"platforms/ios/Alpine/Tests/node-flags.c",
			`${kernel}/kernel/node_flags.c`,
			`${kernel}/kernel/node_binary.c`,
		],
		[process.execPath, process.versions.v8],
	);
	const [status, ...args] = result.stdout.trim().split("\n");
	expect(status).toBe("NODE_FLAGS_PASS");
	if (Number.parseInt(process.versions.v8, 10) >= 11) {
		expect(args).toContain("--no-maglev");
	}
	const node = spawnSync(
		process.execPath,
		[...args, "-e", "process.stdout.write(typeof WebAssembly)"],
		{ encoding: "utf8", timeout: 10000 },
	);
	expect(node.stderr).toBe("");
	expect(node.stdout).toBe("object");
});

nativeTest("Alpine guards Node scans and caches only successful reads", () => {
	const result = runNative(
		[
			"platforms/ios/Alpine/Tests/node-runtime.c",
			`${kernel}/kernel/node.c`,
			`${kernel}/kernel/node_flags.c`,
			`${kernel}/kernel/node_binary.c`,
		],
		[],
	);
	expect(result.stdout.trim()).toBe("NODE_RUNTIME_PASS");
});

function runNative(sources, args) {
	const directory = mkdtempSync(join(tmpdir(), "acode-alpine-native-"));
	try {
		const executable = join(directory, "native-test");
		const build = spawnSync(
			"clang",
			[
				"-Wall",
				"-Wextra",
				"-Werror",
				"-DGUEST_ARM64",
				"-D_GNU_SOURCE",
				"-pthread",
				...sanitizers,
				`-I${kernel}`,
				...sources,
				"-o",
				executable,
			],
			{ encoding: "utf8" },
		);
		expect(build.status, build.stderr).toBe(0);
		const result = spawnSync(executable, args, {
			encoding: "utf8",
			timeout: 30000,
		});
		expect(result.status, result.stderr).toBe(0);
		return result;
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

function sanitizerFlags() {
	const flags = ["-fsanitize=address,undefined"];
	const directory = mkdtempSync(join(tmpdir(), "acode-sanitizer-"));
	try {
		const executable = join(directory, "probe");
		const build = spawnSync(
			"clang",
			[...flags, "-x", "c", "-", "-o", executable],
			{ input: "int main(void) { return 0; }" },
		);
		if (build.status === 0 && spawnSync(executable).status === 0) return flags;
		console.warn("Sanitizer runtime unavailable; native tests run without it.");
		return [];
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}
