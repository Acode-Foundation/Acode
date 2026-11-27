import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

const source = readFileSync(
	new URL(
		"../../platforms/android/app/src/main/assets/init-alpine.sh",
		import.meta.url,
	),
	"utf8",
);
// Preparation tests stop before unrelated writes to guest-only filesystem paths.
const setup = source.slice(
	0,
	source.indexOf("if [ ! -f /linkerconfig/ld.config.txt ]; then"),
);
const commonPackages = "bash command-not-found tzdata wget curl libstdc++";
const iosPackages = `${commonPackages} procps-ng tar gzip`;

test.each([
	false,
	true,
])("complete Alpine setup avoids network operations (iOS: %s)", (ios) => {
	const result = runSetup({
		ios,
		installed: ios ? iosPackages : commonPackages,
	});
	expect(result.status).toBe(0);
	expect(result.configured).toBe(true);
	expect(result.calls).not.toMatch(/^(update|upgrade|add)(?: |$)/m);
});

test.each([
	false,
	true,
])("missing Alpine packages are installed and verified (iOS: %s)", (ios) => {
	const result = runSetup({ ios });
	expect(result.status).toBe(0);
	expect(result.configured).toBe(true);
	expect(result.calls).toContain(
		`add curl libstdc++${ios ? " procps-ng tar gzip" : ""}\n`,
	);
	expect(result.calls.trim().split("\n").at(-1)).toBe(
		`info -e ${ios ? iosPackages : commonPackages}`,
	);
	expect(result.stdout).toContain("Successfully installed");
});

test.each([
	["--installing", "fail"],
	["--prepare", "fail"],
	["--installing", "incomplete"],
	["--prepare", "incomplete"],
])("Alpine %s rejects package installation mode %s", (flag, addMode) => {
	const result = runSetup({ flag, addMode });
	expect(result.status).toBe(1);
	expect(result.configured).toBe(false);
	expect(result.stderr).toContain("Failed to install required Alpine packages");
	expect(result.stdout).not.toContain("Successfully installed");
});

test("cached Alpine packages can install after a repository refresh fails", () => {
	const result = runSetup({ updateFails: true });
	expect(result.status).toBe(0);
	expect(result.configured).toBe(true);
	expect(result.calls).toContain("add curl libstdc++ procps-ng tar gzip");
	expect(result.calls).not.toMatch(/^upgrade(?: |$)/m);
});

test("ordinary Android shell startup continues after package setup fails", () => {
	const result = runSetup({ ios: false, flag: "", addMode: "fail" });
	expect(result.status).toBe(0);
	expect(result.stderr).toContain("Failed to install required Alpine packages");
});

test("command execution bypasses Alpine package setup", () => {
	const result = runSetup({ args: ["--", "/bin/sh", "-c", "exit 7"] });
	expect(result.status).toBe(7);
	expect(result.calls).toBe("");
	expect(result.configured).toBe(false);
});

function runSetup({
	ios = true,
	installed = "bash command-not-found tzdata wget",
	flag = "--installing",
	addMode = "success",
	updateFails = false,
	args = flag ? [flag] : [],
} = {}) {
	const directory = mkdtempSync(join(tmpdir(), "acode-alpine-setup-"));
	const log = join(directory, "apk.log");
	try {
		const result = spawnSync(
			"/bin/sh",
			[
				"-c",
				`
apk() {
    printf '%s\\n' "$*" >> "$APK_LOG"
    case "$1" in
        info)
            shift 2
            missing=0
            for pkg in "$@"; do
                case " $INSTALLED_PACKAGES " in
                    *" $pkg "*) printf '%s\\n' "$pkg" ;;
                    *) missing=1 ;;
                esac
            done
            return "$missing"
            ;;
        update) [ "$UPDATE_FAILS" != true ] ;;
        upgrade) return 0 ;;
        add)
            [ "$ADD_MODE" != fail ] || return 1
            if [ "$ADD_MODE" = success ]; then
                shift
                INSTALLED_PACKAGES="$INSTALLED_PACKAGES $*"
            fi
            return 0
            ;;
    esac
}
mkdir() {
    if [ "$2" = "$PREFIX/.configured" ]; then command mkdir "$@"; fi
}
touch() { return 0; }
chmod() { return 0; }
${flag === "--installing" ? source : setup}
`,
				"alpine-setup",
				...args,
			],
			{
				encoding: "utf8",
				timeout: 5000,
				env: {
					...process.env,
					PREFIX: directory,
					ALPINE_ROOT: ios ? "/" : join(directory, "alpine"),
					APK_LOG: log,
					INSTALLED_PACKAGES: installed,
					ADD_MODE: addMode,
					UPDATE_FAILS: String(updateFails),
					ANDROID_TZ: "",
				},
			},
		);
		if (result.error) throw result.error;
		return {
			...result,
			configured: existsSync(join(directory, ".configured")),
			calls: existsSync(log) ? readFileSync(log, "utf8") : "",
		};
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}
