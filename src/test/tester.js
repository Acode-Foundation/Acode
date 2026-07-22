import tag from "html-tag-js";
import EditorFile from "lib/editorFile";
import { testDefinitions } from "./test-definitions";

// Global Runner State
let currentRunnerState = {
	status: "idle", // "idle", "running", "completed"
	suites: [],
	stats: {
		total: 0,
		passed: 0,
		failed: 0,
		skipped: 0,
		successRate: "0.0",
	},
	logs: "",
};

let activeRunners = [];
let isRegistrationPass = false;

// DOM references
let $pageBody = null;
let $statsTotal = null;
let $statsPassed = null;
let $statsFailed = null;
let $statsSkipped = null;
let $statsSuccessRate = null;
let $progressBar = null;
let $runBtn = null;
let $suiteList = null;

const suiteElementsMap = new Map();

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// Update the entire dashboard and components
function updateUI() {
	if (!$pageBody) return;

	// 1. Update stats
	if ($statsTotal) $statsTotal.textContent = currentRunnerState.stats.total;
	if ($statsPassed) $statsPassed.textContent = currentRunnerState.stats.passed;
	if ($statsFailed) $statsFailed.textContent = currentRunnerState.stats.failed;
	if ($statsSkipped)
		$statsSkipped.textContent = currentRunnerState.stats.skipped;

	const effectiveTotal =
		currentRunnerState.stats.total - currentRunnerState.stats.skipped;
	const rate =
		effectiveTotal > 0
			? ((currentRunnerState.stats.passed / effectiveTotal) * 100).toFixed(1)
			: "0.0";
	if ($statsSuccessRate) $statsSuccessRate.textContent = rate + "%";

	// 2. Update progress bar
	if ($progressBar) {
		const total = currentRunnerState.stats.total;
		const completed =
			currentRunnerState.stats.passed +
			currentRunnerState.stats.failed +
			currentRunnerState.stats.skipped;
		const pct = total > 0 ? (completed / total) * 100 : 0;
		$progressBar.style.width = pct + "%";
	}

	// 3. Update Run button status
	if ($runBtn) {
		if (currentRunnerState.status === "running") {
			$runBtn.classList.add("running");
			$runBtn.disabled = true;
			$runBtn.innerHTML = '<span class="icon loader"></span> Running...';
		} else {
			$runBtn.classList.remove("running");
			$runBtn.disabled = false;
			$runBtn.innerHTML =
				'<span class="icon play_circle_filled"></span> Run Tests';
		}
	}

	// 4. Render/Update each suite card
	currentRunnerState.suites.forEach((suite) => {
		updateSuiteElement(suite);
	});
}

function getOrCreateSuiteElement(suite) {
	if (suiteElementsMap.has(suite.name)) {
		return suiteElementsMap.get(suite.name);
	}

	// Create suite element components
	let isCollapsed = false;
	const $body = <div className="suite-body"></div>;

	const toggleCollapse = () => {
		isCollapsed = !isCollapsed;
		if (isCollapsed) {
			$body.classList.add("collapsed");
		} else {
			$body.classList.remove("collapsed");
		}
	};

	const $header = (
		<div className="suite-header" onclick={toggleCollapse}>
			<div className="suite-info">
				<span className="suite-status-icon"></span>
				<span className="suite-title">{suite.name}</span>
			</div>
			<div className="suite-meta">
				<span className="suite-badge"></span>
			</div>
		</div>
	);

	const $el = (
		<div className="suite-card">
			{$header}
			{$body}
		</div>
	);

	if ($suiteList) {
		$suiteList.append($el);
	}

	const suiteData = {
		el: $el,
		header: $header,
		body: $body,
		statusIcon: $header.querySelector(".suite-status-icon"),
		badge: $header.querySelector(".suite-badge"),
	};

	suiteElementsMap.set(suite.name, suiteData);
	return suiteData;
}

function updateSuiteElement(suite) {
	const { body, statusIcon, badge } = getOrCreateSuiteElement(suite);

	// Update status icon
	statusIcon.className = "suite-status-icon";
	if (suite.status === "completed") {
		if (suite.failed > 0) {
			statusIcon.className += " fail icon cancel";
		} else {
			statusIcon.className += " pass icon check_circle";
		}
	} else if (suite.status === "running") {
		statusIcon.className += " running icon loader";
	} else {
		statusIcon.className += " pending icon help";
	}

	// Update badge
	badge.className = "suite-badge";
	if (suite.failed > 0) {
		badge.className += " fail";
		badge.textContent = `${suite.passed}/${suite.total} passed · ${suite.failed} failed`;
	} else {
		badge.className += " pass";
		badge.textContent = `${suite.passed}/${suite.total} passed`;
	}

	// Render tests inside body
	body.innerHTML = "";
	suite.tests.forEach((test) => {
		let iconClass = "help";
		let iconStyle = { color: "var(--secondary-text-color)" };
		if (test.status === "PASS") {
			iconClass = "check_circle";
			iconStyle = { color: "var(--active-color)" };
		} else if (test.status === "FAIL") {
			iconClass = "cancel";
			iconStyle = { color: "var(--danger-color)" };
		} else if (test.status === "SKIP") {
			iconClass = "warningreport_problem";
			iconStyle = { color: "var(--error-text-color)" };
		} else if (test.status === "running") {
			iconClass = "loader";
			iconStyle = { color: "var(--active-color)" };
		}

		const $item = (
			<div className="test-item">
				<div className="test-row">
					<div className="test-name-container">
						<span className={`icon ${iconClass}`} style={iconStyle}></span>
						<span className="test-name">{test.name}</span>
					</div>
					{test.time !== undefined && (
						<span className="test-time">{test.time}ms</span>
					)}
				</div>
				{test.status === "FAIL" && test.error && (
					<pre className="test-error-block">{test.error}</pre>
				)}
				{test.status === "SKIP" && test.reason && (
					<div
						className="test-error-block"
						style={{
							color: "var(--error-text-color)",
							borderColor:
								"color-mix(in srgb, var(--error-text-color) 30%, transparent)",
						}}
					>
						{test.reason}
					</div>
				)}
			</div>
		);
		body.append($item);
	});
}

function createTestRunnerContent() {
	const triggerRun = (e) => {
		e.preventDefault();
		e.stopPropagation();
		if (currentRunnerState.status !== "running") {
			registerAllSuites();
			runTestsInternal();
		}
	};

	$runBtn = (
		<button className="run-btn" onclick={triggerRun}>
			<span className="icon play_circle_filled"></span> Run Tests
		</button>
	);

	$statsTotal = <span className="stat-value">0</span>;
	$statsPassed = <span className="stat-value">0</span>;
	$statsFailed = <span className="stat-value">0</span>;
	$statsSkipped = <span className="stat-value">0</span>;
	$statsSuccessRate = <span className="stat-value">0.0%</span>;

	$progressBar = <div className="progress-bar"></div>;
	$suiteList = <div className="suite-list"></div>;

	const style = (
		<style>
			{`
				#test-runner-page {
					display: flex;
					flex-direction: column;
					height: 100%;
					width: 100%;
					background-color: var(--primary-color);
					color: var(--primary-text-color);
					font-family: var(--app-font-family);
					overflow: hidden;
					box-sizing: border-box;
				}

				.run-btn {
					display: flex;
					align-items: center;
					gap: 6px;
					background-color: var(--button-background-color);
					color: var(--button-text-color);
					border: none;
					padding: 6px 12px;
					border-radius: 4px;
					font-size: 12px;
					font-weight: 500;
					cursor: pointer;
					transition: background-color 0.2s ease;
				}
				.run-btn:active {
					background-color: var(--button-active-color);
				}
				.run-btn.running {
					background-color: var(--border-color);
					pointer-events: none;
					opacity: 0.7;
				}
				.icon.loader {
					animation: spin 1s linear infinite;
				}

				/* Page Scroll Container */
				.runner-body {
					flex: 1;
					overflow-y: auto;
					padding: 0;
					display: flex;
					flex-direction: column;
				}

				/* Progress bar */
				.progress-container {
					width: 100%;
					height: 4px;
					background-color: var(--border-color);
					overflow: hidden;
					position: relative;
					flex-shrink: 0;
				}
				.progress-bar {
					height: 100%;
					width: 0%;
					background-color: var(--active-color);
					transition: width 0.3s ease;
				}

				/* Stats Bar & Controls */
				.stats-container {
					display: flex;
					align-items: center;
					justify-content: space-between;
					gap: 16px;
					padding: 8px 12px;
					background-color: var(--secondary-color);
					border-bottom: 1px solid var(--border-color);
					flex-shrink: 0;
				}
				.stats-left {
					display: flex;
					align-items: center;
				}
				.stats-right {
					display: flex;
					align-items: center;
					gap: 12px;
					flex-wrap: wrap;
				}
				.stat-item {
					display: flex;
					align-items: center;
					gap: 4px;
					font-size: 11px;
				}
				.stat-label {
					font-weight: 500;
					color: var(--secondary-text-color);
				}
				.stat-value {
					font-weight: bold;
					color: var(--primary-text-color);
				}
				.stat-item.passed .stat-value { color: var(--active-color); }
				.stat-item.failed .stat-value { color: var(--danger-color); }
				.stat-item.skipped .stat-value { color: var(--error-text-color); }

				/* Suite Accordions */
				.suite-list {
					display: flex;
					flex-direction: column;
				}
				.suite-card {
					border-bottom: 1px solid var(--border-color);
				}
				.suite-header {
					padding: 12px 16px;
					display: flex;
					justify-content: space-between;
					align-items: center;
					cursor: pointer;
					user-select: none;
					background-color: var(--primary-color);
					transition: background-color 0.15s ease;
				}
				.suite-header:hover {
					background-color: color-mix(in srgb, var(--border-color) 10%, transparent);
				}
				.suite-info {
					display: flex;
					align-items: center;
					gap: 8px;
				}
				.suite-title {
					font-size: 13px;
					font-weight: 600;
					color: var(--primary-text-color);
				}
				.suite-status-icon {
					width: 16px;
					height: 16px;
					display: flex;
					align-items: center;
					justify-content: center;
					font-size: 14px;
				}
				.suite-status-icon.pass { color: var(--active-color); }
				.suite-status-icon.fail { color: var(--danger-color); }
				.suite-status-icon.running {
					color: var(--active-color);
					animation: spin 1s linear infinite;
				}
				.suite-status-icon.pending { color: var(--secondary-text-color); }

				.suite-meta {
					display: flex;
					align-items: center;
					gap: 8px;
				}
				.suite-badge {
					font-size: 11px;
					color: var(--secondary-text-color);
				}
				.suite-badge.pass {
					color: var(--active-color);
				}
				.suite-badge.fail {
					color: var(--danger-color);
					font-weight: bold;
				}

				/* Suite body and tests */
				.suite-body {
					border-top: 1px solid var(--border-color);
					padding: 0 16px;
					display: flex;
					flex-direction: column;
					background-color: var(--secondary-color);
				}
				.suite-body.collapsed {
					display: none;
				}
				.test-item {
					padding: 10px 0;
					display: flex;
					flex-direction: column;
					gap: 4px;
				}
				.test-item:not(:last-child) {
					border-bottom: 1px solid color-mix(in srgb, var(--border-color) 50%, transparent);
				}
				.test-row {
					display: flex;
					justify-content: space-between;
					align-items: center;
				}
				.test-name-container {
					display: flex;
					align-items: center;
					gap: 10px;
				}
				.test-name-container .icon {
					font-size: 16px;
				}
				.test-name {
					font-size: 13px;
					color: var(--primary-text-color);
				}
				.test-time {
					font-size: 11px;
					color: var(--secondary-text-color);
				}
				.test-error-block {
					background-color: var(--primary-color);
					border: 1px solid var(--border-color);
					border-radius: 4px;
					padding: 8px;
					font-family: monospace;
					font-size: 11px;
					color: var(--danger-color);
					white-space: pre-wrap;
					word-break: break-all;
					margin-left: 26px;
					margin-top: 4px;
				}

				@keyframes spin {
					0% { transform: rotate(0deg); }
					100% { transform: rotate(360deg); }
				}
			`}
		</style>
	);

	$pageBody = (
		<div id="test-runner-page">
			{style}
			<div className="progress-container">{$progressBar}</div>
			<div className="runner-body scroll">
				<div className="stats-container">
					<div className="stats-left">{$runBtn}</div>
					<div className="stats-right">
						<div className="stat-item rate">
							<span className="stat-label">Success:</span>
							{$statsSuccessRate}
						</div>
						<div className="stat-item passed">
							<span className="stat-label">Passed:</span>
							{$statsPassed}
						</div>
						<div className="stat-item failed">
							<span className="stat-label">Failed:</span>
							{$statsFailed}
						</div>
						<div className="stat-item skipped">
							<span className="stat-label">Skipped:</span>
							{$statsSkipped}
						</div>
						<div className="stat-item">
							<span className="stat-label">Total:</span>
							{$statsTotal}
						</div>
					</div>
				</div>

				{$suiteList}
			</div>
		</div>
	);

	return $pageBody;
}

function registerAllSuites() {
	isRegistrationPass = true;
	activeRunners = [];
	currentRunnerState.status = "idle";
	currentRunnerState.suites = [];
	currentRunnerState.stats = {
		total: 0,
		passed: 0,
		failed: 0,
		skipped: 0,
		successRate: "0.0",
	};
	suiteElementsMap.clear();
	if ($suiteList) $suiteList.innerHTML = "";

	// Execute suite functions in registration mode to populate the tree view
	for (const runTestSuite of testDefinitions) {
		runTestSuite(null);
	}
	isRegistrationPass = false;
}

async function runTestsInternal() {
	currentRunnerState.status = "running";
	currentRunnerState.stats = {
		total: currentRunnerState.stats.total,
		passed: 0,
		failed: 0,
		skipped: 0,
		successRate: "0.0",
	};
	currentRunnerState.logs = "";

	// Reset all suite and test states in UI to pending before we start
	activeRunners.forEach((runner) => {
		runner.suiteState.status = "pending";
		runner.suiteState.passed = 0;
		runner.suiteState.failed = 0;
		runner.suiteState.skipped = 0;
		runner.suiteState.tests.forEach((t) => {
			t.status = "pending";
			t.time = undefined;
			t.error = undefined;
			t.reason = undefined;
		});
	});
	updateUI();

	function writeOutput(data) {
		currentRunnerState.logs += data;
		console.log(data);
	}

	writeOutput("🚀 Test Runner Started\n");
	writeOutput("Running Acode test suite...\n");

	try {
		for (const runner of activeRunners) {
			await runner.executeSuite(writeOutput);
		}
		writeOutput("\n🎉 All test suites completed!\n");
	} catch (error) {
		writeOutput(`\n⚠️ Test execution error: ${error.message}\n`);
		if (error.stack) {
			writeOutput(`${error.stack}\n`);
		}
	} finally {
		currentRunnerState.status = "completed";
		updateUI();
		const testRunnerTab = editorManager.files.find(
			(f) => f.id === "test-runner",
		);
		if (testRunnerTab && editorManager.activeFile?.id !== "test-runner") {
			testRunnerTab.makeActive();
		}
	}
}

export function openTestRunnerTab() {
	const existingFile = editorManager.files.find((f) => f.id === "test-runner");
	if (existingFile) {
		existingFile.makeActive();
		if (currentRunnerState.status !== "running") {
			registerAllSuites();
			runTestsInternal();
		}
		return;
	}

	const content = createTestRunnerContent();

	const testRunnerFile = new EditorFile("Test Runner", {
		id: "test-runner",
		render: true,
		type: "page",
		content: content,
		tabIcon: "icon verified",
		hideQuickTools: true,
	});

	const onFileRemoved = (removedFile) => {
		if (removedFile.id === "test-runner") {
			$pageBody = null;
			$statsTotal = null;
			$statsPassed = null;
			$statsFailed = null;
			$statsSkipped = null;
			$statsSuccessRate = null;
			$progressBar = null;
			$runBtn = null;
			$suiteList = null;
			suiteElementsMap.clear();
			activeRunners = [];

			editorManager.off("remove-file", onFileRemoved);
		}
	};
	editorManager.on("remove-file", onFileRemoved);

	testRunnerFile.setCustomTitle(() => "Verification");
	testRunnerFile.makeActive();

	// Load and register all test definitions immediately so they are shown in the UI
	registerAllSuites();
	runTestsInternal();
}

export async function runAllTests() {
	openTestRunnerTab();
}

class TestRunner {
	constructor(name = "Test Suite", register = true) {
		this.name = name;
		this.tests = [];
		this.passed = 0;
		this.failed = 0;
		this.results = [];
		this.skipped = 0;

		this.suiteState = {
			name: this.name,
			status: "pending",
			tests: [],
			passed: 0,
			failed: 0,
			skipped: 0,
			total: 0,
		};
		if (register) {
			currentRunnerState.suites.push(this.suiteState);
			activeRunners.push(this);
			updateUI();
		}
	}

	/**
	 * Register a test
	 */
	test(testName, testFn, options = {}) {
		const timeout = typeof options === "number" ? options : options?.timeout;
		this.tests.push({ name: testName, fn: testFn, timeout });
		this.suiteState.tests.push({
			name: testName,
			status: "pending",
		});
		this.suiteState.total++;
		currentRunnerState.stats.total++;
		updateUI();
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

	skip(reason = "Skipped") {
		throw new SkipTest(reason);
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
	 * Run all tests in this suite
	 */
	async run(writeOutput) {
		if (isRegistrationPass) {
			return this.results;
		}
		return await this.executeSuite(writeOutput);
	}

	async executeSuite(writeOutput) {
		const line = (text = "") => {
			writeOutput(`${text}\n`);
		};

		this.passed = 0;
		this.failed = 0;
		this.skipped = 0;
		this.results = [];

		this.suiteState.status = "running";
		this.suiteState.passed = 0;
		this.suiteState.failed = 0;
		this.suiteState.skipped = 0;
		updateUI();

		line(`🧪 Running suite: ${this.name}`);

		// Run tests
		for (const test of this.tests) {
			const tState = this.suiteState.tests.find((t) => t.name === test.name);
			if (tState) {
				tState.status = "running";
				updateUI();
			}
			const startTime = performance.now();
			try {
				await delay(50);

				await this._runWithTimeout(test.fn, this, test.timeout ?? 10000);

				const duration = Math.max(
					0,
					Math.round(performance.now() - startTime) - 50,
				);
				this.passed++;
				this.results.push({ name: test.name, status: "PASS" });

				if (tState) {
					tState.status = "PASS";
					tState.time = duration;
				}
				this.suiteState.passed++;
				currentRunnerState.stats.passed++;

				line(`  ✓ ${test.name} (${duration}ms)`);
			} catch (error) {
				const duration = Math.max(
					0,
					Math.round(performance.now() - startTime) - 50,
				);
				if (error instanceof SkipTest) {
					this.skipped++;
					this.results.push({
						name: test.name,
						status: "SKIP",
						reason: error.message,
					});

					if (tState) {
						tState.status = "SKIP";
						tState.reason = error.message;
						tState.time = duration;
					}
					this.suiteState.skipped++;
					currentRunnerState.stats.skipped++;

					line(`  ? ${test.name} - Skipped: ${error.message}`);
				} else {
					this.failed++;
					this.results.push({
						name: test.name,
						status: "FAIL",
						error: error.message,
					});

					if (tState) {
						tState.status = "FAIL";
						tState.error = error.message;
						tState.time = duration;
					}
					this.suiteState.failed++;
					currentRunnerState.stats.failed++;

					line(`  ✗ ${test.name} - Failed: ${error.message}`);
				}
			}
			const testRunnerTab = editorManager.files.find(
				(f) => f.id === "test-runner",
			);
			if (testRunnerTab && editorManager.activeFile?.id !== "test-runner") {
				testRunnerTab.makeActive();
			}
			updateUI();
		}

		this.suiteState.status = "completed";
		updateUI();

		const total = this.tests.length;
		const effectiveTotal = total - this.skipped;

		const percentage = effectiveTotal
			? ((this.passed / effectiveTotal) * 100).toFixed(1)
			: "0.0";

		line(
			`📋 Suite Summary: ${this.passed}/${total} passed (Success Rate: ${percentage}%)\n`,
		);

		return this.results;
	}

	_padCenter(text, width) {
		const pad = Math.max(0, width - text.length);
		return (
			" ".repeat(Math.floor(pad / 2)) + text + " ".repeat(Math.ceil(pad / 2))
		);
	}
}

class SkipTest extends Error {
	constructor(message = "Skipped") {
		super(message);
		this.name = "SkipTest";
	}
}

export { SkipTest, TestRunner };
