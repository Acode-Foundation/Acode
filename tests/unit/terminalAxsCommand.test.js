import fs from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * AXS (`acodex_server`) does not run its `-c` payload through a shell.
 * `create_terminal` tokenizes it with `split_whitespace()` and treats the first
 * token as the program to spawn:
 *
 *   let mut program = String::from("login");
 *   let parts: Vec<String> = cmd.split_whitespace().map(|s| s.to_string()).collect();
 *   program = parts[0].clone();
 *
 * So a shell-only prefix such as `exec` becomes the program name and the spawn
 * fails with `Unable to spawn exec because: No viable candidates found in PATH`.
 * That regression shipped in the Ubuntu branch as `-c "exec bash --rcfile ..."`.
 */

const SCRIPTS = [
	"src/plugins/terminal/scripts/init-ubuntu.sh",
	"src/plugins/terminal/scripts/init-sandbox.sh",
];

// Builtins/keywords that are not standalone executables, so they can never
// resolve as `parts[0]` of an AXS command line.
const SHELL_ONLY_WORDS = new Set([
	".",
	"alias",
	"bg",
	"cd",
	"declare",
	"disown",
	"eval",
	"exec",
	"export",
	"fc",
	"fg",
	"hash",
	"jobs",
	"local",
	"read",
	"readonly",
	"return",
	"set",
	"shift",
	"source",
	"trap",
	"typeset",
	"ulimit",
	"umask",
	"unalias",
	"unset",
	"wait",
]);

/** Extract every `axs ... -c "<cmd>"` payload from a script. */
function axsCommands(source) {
	const commands = [];
	const pattern = /axs"\s+-c\s+"([^"]*)"/g;
	for (const match of source.matchAll(pattern)) {
		commands.push(match[1]);
	}
	return commands;
}

// Mirror AXS's own tokenization so the assertions match runtime behaviour.
const toProgramArgs = (cmd) => {
	const parts = cmd.split(/\s+/).filter(Boolean);
	return { program: parts[0], args: parts.slice(1) };
};

describe("AXS launch commands", () => {
	for (const script of SCRIPTS) {
		it(`spawns a real program for every -c payload in ${script}`, () => {
			const source = fs.readFileSync(
				new URL(`../../${script}`, import.meta.url),
				"utf8",
			);

			const commands = axsCommands(source);
			expect(commands.length, `no axs -c payload found in ${script}`).toBeGreaterThan(0);

			for (const command of commands) {
				const { program, args } = toProgramArgs(command);

				expect(program, `empty program in -c "${command}"`).toBeTruthy();
				expect(
					SHELL_ONLY_WORDS.has(program),
					`-c "${command}" starts with the shell-only word "${program}"; ` +
						"AXS resolves the first token as the program to spawn",
				).toBe(false);
				// A program name must not carry shell syntax.
				expect(program).toMatch(/^[A-Za-z0-9_./+-]+$/);
				// Args, when present, are plain operands.
				for (const arg of args) {
					expect(arg).not.toMatch(/[\s]/);
				}
			}
		});
	}

	it("resolves the Ubuntu interactive shell to bash with the initrc", () => {
		const source = fs.readFileSync(
			new URL(
				"../../src/plugins/terminal/scripts/init-ubuntu.sh",
				import.meta.url,
			),
			"utf8",
		);

		const { program, args } = toProgramArgs(axsCommands(source)[0]);
		expect(program).toBe("bash");
		expect(args).toContain("--rcfile");
		expect(args).toContain("/initrc");
		expect(args).toContain("-i");
	});
});
