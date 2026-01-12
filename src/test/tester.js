import { runAceEditorTests } from "./editor.tests";
import { runSanityTests } from "./sanity.tests";

export async function runAllTests() {
	const terminal = acode.require("terminal");
	const local = await terminal.createLocal({ name: "TestCode" });
	function write(data) {
		terminal.write(local.id, data);
	}

	// Run tests at runtime
	write("\x1b[36m\x1b[1m🚀 TestCode Plugin Loaded\x1b[0m\n");
	write("\x1b[36m\x1b[1mStarting test execution...\x1b[0m\n");

	try {
		// Run unit tests
		await runSanityTests(write);
		await runAceEditorTests(write);

		write("\x1b[36m\x1b[1mTests completed!\x1b[0m\n");
	} catch (error) {
		write(`\x1b[31m⚠️ Test execution error: ${error.message}\x1b[0m\n`);
	}
}

// ANSI color codes for terminal output
const COLORS = {
	RESET: "\x1b[0m",
	BRIGHT: "\x1b[1m",
	DIM: "\x1b[2m",
	ITALIC: "\x1b[3m",

	// Foreground colors
	RED: "\x1b[31m",
	GREEN: "\x1b[32m",
	YELLOW: "\x1b[33m",
	BLUE: "\x1b[34m",
	MAGENTA: "\x1b[35m",
	CYAN: "\x1b[36m",
	WHITE: "\x1b[37m",
	GRAY: "\x1b[90m",

	// Background colors
	BG_RED: "\x1b[41m",
	BG_GREEN: "\x1b[42m",
	BG_YELLOW: "\x1b[43m",
	BG_BLUE: "\x1b[44m",
};

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function startSpinner(writeOutput, text) {
	let index = 0;
	let active = true;

	const timer = setInterval(() => {
		if (!active) return;
		const frame = SPINNER_FRAMES[index++ % SPINNER_FRAMES.length];
		// \r moves cursor to start, \x1b[K clears the line to the right
		writeOutput(`\r  ${COLORS.CYAN}${frame}${COLORS.RESET} ${text}`);
	}, 80);

	return () => {
		active = false;
		clearInterval(timer);
		// Clear the line so the "Success/Fail" message can take its place
		writeOutput("\r\x1b[K");
	};
}

// Spinner frames
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

class TestRunner {
	constructor(name = "Test Suite") {
		this.name = name;
		this.tests = [];
		this.passed = 0;
		this.failed = 0;
		this.results = [];
	}

	/**
	 * Register a test
	 */
	test(testName, testFn) {
		this.tests.push({ name: testName, fn: testFn });
	}

	/**
	 * Assertions
	 */
	assert(condition, message) {
		if (!condition) {
			throw new Error(message || "Assertion failed");
		}
	}

	assertEqual(actual, expected, message) {
		if (actual !== expected) {
			throw new Error(message || `Expected ${expected}, got ${actual}`);
		}
	}

	async _runWithTimeout(fn, ctx, timeoutMs) {
		return new Promise((resolve, reject) => {
			let finished = false;

			const timer = setTimeout(() => {
				if (finished) return;
				finished = true;
				reject(new Error(`Test timed out after ${timeoutMs}ms`));
			}, timeoutMs);

			Promise.resolve()
				.then(() => fn(ctx))
				.then((result) => {
					if (finished) return;
					finished = true;
					clearTimeout(timer);
					resolve(result);
				})
				.catch((err) => {
					if (finished) return;
					finished = true;
					clearTimeout(timer);
					reject(err);
				});
		});
	}

	/**
	 * Run all tests
	 */
	async run(writeOutput) {
		const line = (text = "", color = "") => {
			writeOutput(`${color}${text}${COLORS.RESET}\n`);
		};

		// Header
		line();
		line(
			"╔════════════════════════════════════════════╗",
			COLORS.CYAN + COLORS.BRIGHT,
		);
		line(
			`║ 🧪  ${this._padCenter(this.name, 35)} │`,
			COLORS.CYAN + COLORS.BRIGHT,
		);
		line(
			"╚════════════════════════════════════════════╝",
			COLORS.CYAN + COLORS.BRIGHT,
		);
		line();

		// Run tests with spinner
		for (const test of this.tests) {
			const stopSpinner = startSpinner(writeOutput, `Running ${test.name}...`);

			try {
				await delay(200);

				await this._runWithTimeout(test.fn, this, 3000);

				stopSpinner();

				this.passed++;
				this.results.push({ name: test.name, status: "PASS", error: null });
				line(`  ${COLORS.GREEN}✓${COLORS.RESET} ${test.name}`, COLORS.GREEN);
			} catch (error) {
				stopSpinner();

				this.failed++;
				this.results.push({
					name: test.name,
					status: "FAIL",
					error: error.message,
				});
				line(
					`  ${COLORS.RED}✗${COLORS.RESET} ${test.name}`,
					COLORS.RED + COLORS.BRIGHT,
				);
				line(
					`     ${COLORS.DIM}└─ ${error.message}${COLORS.RESET}`,
					COLORS.RED + COLORS.DIM,
				);
			}
		}

		// Summary
		line();
		line("─────────────────────────────────────────────", COLORS.GRAY);

		const total = this.tests.length;
		const percentage = total ? ((this.passed / total) * 100).toFixed(1) : "0.0";

		const statusColor = this.failed === 0 ? COLORS.GREEN : COLORS.YELLOW;

		line(
			`  Tests: ${COLORS.BRIGHT}${total}${COLORS.RESET} | ` +
				`${statusColor}Passed: ${this.passed}${COLORS.RESET} | ` +
				`${COLORS.RED}Failed: ${this.failed}${COLORS.RESET}`,
			statusColor,
		);

		line(
			`  Success Rate: ${statusColor}${percentage}%${COLORS.RESET}`,
			statusColor,
		);
		line("─────────────────────────────────────────────", COLORS.GRAY);
		line();

		return this.results;
	}

	/**
	 * Center text helper
	 */
	_padCenter(text, width) {
		const pad = Math.max(0, width - text.length);
		return (
			" ".repeat(Math.floor(pad / 2)) + text + " ".repeat(Math.ceil(pad / 2))
		);
	}
}

export { TestRunner };
