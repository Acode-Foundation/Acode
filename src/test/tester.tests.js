import { SkipTest, TestRunner } from "./tester";

// A tester to test the tester
export async function runTesterTests(writeOutput) {
	const runner = new TestRunner("Test Runner Verification");

	// Test 1: Assertions passing
	runner.test("Assertion passing", (test) => {
		test.assert(true, "True should pass");
	});

	// Test 2: Assertions failing
	runner.test("Assertion failing", (test) => {
		try {
			test.assert(false, "Should fail");
			throw new Error("Should have thrown assertion failure");
		} catch (e) {
			test.assertEqual(e.message, "Should fail");
		}
	});

	// Test 3: Assert equal passing
	runner.test("Assert equal passing", (test) => {
		test.assertEqual(1 + 1, 2, "1 + 1 = 2");
	});

	// Test 4: Assert equal failing
	runner.test("Assert equal failing", (test) => {
		try {
			test.assertEqual(1 + 1, 3, "1 + 1 != 3");
			throw new Error("Should have thrown assertion failure");
		} catch (e) {
			test.assertEqual(e.message, "1 + 1 != 3");
		}
	});

	// Test 5: Skip test handling
	runner.test("Skip test handling", async (test) => {
		try {
			test.skip("Ignore this test");
			throw new Error("Should have skipped");
		} catch (e) {
			test.assert(e instanceof SkipTest, "Should throw SkipTest instance");
			test.assertEqual(e.message, "Ignore this test");
		}
	});

	// Test 6: Async timeout verification
	runner.test("Async timeout verification", async (test) => {
		// Use register = false so this mock runner doesn't pollute Acode UI state
		const dummyRunner = new TestRunner("Dummy Suite", false);
		dummyRunner.test("Long running test", async () => {
			return new Promise((resolve) => setTimeout(resolve, 500));
		});

		// Run with a very short timeout of 50ms
		try {
			await dummyRunner._runWithTimeout(
				dummyRunner.tests[0].fn,
				dummyRunner,
				50,
			);
			throw new Error("Test should have timed out");
		} catch (e) {
			test.assert(
				e.message.includes("timed out"),
				"Should contain timed out message",
			);
		}
	});

	// Test 7: Runner execution and statistics
	runner.test("Runner execution and statistics", async (test) => {
		// Use register = false so this mock runner doesn't pollute Acode UI state
		const mockRunner = new TestRunner("Mock Suite", false);

		mockRunner.test("Passing test", (t) => {
			t.assert(true);
		});

		mockRunner.test("Failing test", (t) => {
			t.assert(false, "Fail intentional");
		});

		mockRunner.test("Skipped test", (t) => {
			t.skip("Skip intentional");
		});

		// Run mock runner with a dummy logger
		const results = await mockRunner.run(() => {});

		test.assertEqual(results.length, 3);
		test.assertEqual(results[0].status, "PASS");
		test.assertEqual(results[1].status, "FAIL");
		test.assertEqual(results[2].status, "SKIP");

		test.assertEqual(mockRunner.passed, 1);
		test.assertEqual(mockRunner.failed, 1);
		test.assertEqual(mockRunner.skipped, 1);
	});

	// Run all verification tests
	return await runner.run(writeOutput);
}
